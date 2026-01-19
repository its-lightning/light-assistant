# ============================================================================
# LIGHT ASSISTANT - Complete Rewrite
# Fixed: Text input, LLM streaming, error handling
# Enhanced: Proper error logging and debugging
# ============================================================================

import os
import secrets
import uuid
import json
import logging
from datetime import timedelta
from dotenv import load_dotenv
from flask import Flask, redirect, url_for, session, render_template, request, jsonify, Response
from authlib.integrations.flask_client import OAuth
from flask_cors import CORS
import requests

# Load environment variables
load_dotenv()

# ============================================
# LOGGING CONFIGURATION
# ============================================
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# ============================================
# CONFIGURATION
# ============================================
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
ALLOWED_EMAILS = os.getenv("ALLOWED_EMAILS", "manoj.srivatsava@gmail.com")
ALLOWED_EMAILS_LIST = [email.strip().lower() for email in ALLOWED_EMAILS.split(",")]
FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32))

# Ollama settings
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
MODEL = os.getenv("MODEL", "llama3:8b")

# URLs
PRODUCTION_URL = os.getenv("PRODUCTION_URL", "https://assistant.itslightning.online")
LOCAL_URL = "http://127.0.0.1:5050"

# Validate critical configuration
if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
    logger.warning("Google OAuth credentials not configured. Authentication will fail.")

logger.info(f"Configuration loaded. Model: {MODEL}")
logger.info(f"Authorized emails: {', '.join(ALLOWED_EMAILS_LIST)}")

# ============================================
# FLASK SETUP
# ============================================
app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY
app.permanent_session_lifetime = timedelta(days=7)
CORS(app)

# OAuth
oauth = OAuth(app)
try:
    oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"}
    )
    logger.info("OAuth configured successfully")
except Exception as e:
    logger.error(f"OAuth configuration failed: {e}")

# Stream storage
active_streams = {}

# Conversation history storage (in-memory, per user session)
conversation_histories = {}

# ============================================
# HELPER FUNCTIONS
# ============================================
def get_logged_in_email():
    """Get current logged-in email"""
    email = session.get("email")
    return email.lower() if email else None

def is_authorized(email):
    """Check if email is authorized"""
    return email and email in ALLOWED_EMAILS_LIST

def require_auth(f):
    """Decorator to require authentication"""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        email = get_logged_in_email()
        if not is_authorized(email):
            logger.warning(f"Unauthorized access attempt by: {email or 'anonymous'}")
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

# ============================================
# AUTHENTICATION ROUTES
# ============================================
@app.route("/login")
def login():
    """Start OAuth login"""
    try:
        if request.host.startswith('127.0.0.1') or request.host.startswith('localhost'):
            redirect_uri = f"{LOCAL_URL}/auth/callback"
        else:
            redirect_uri = f"{PRODUCTION_URL}/auth/callback"
        
        logger.info(f"Initiating OAuth login with redirect: {redirect_uri}")
        return oauth.google.authorize_redirect(redirect_uri)
    except Exception as e:
        logger.error(f"Login error: {e}")
        return f"""
        <html>
            <body style="font-family: sans-serif; padding: 40px; background: #000; color: #fff; text-align: center;">
                <h1 style="color: #ef4444;">Login Error</h1>
                <p>{str(e)}</p>
                <p><a href="/" style="color: #3b82f6;">Back</a></p>
            </body>
        </html>
        """, 500

@app.route("/auth/callback")
def auth_callback():
    """Handle OAuth callback"""
    try:
        logger.info("Processing OAuth callback")
        token = oauth.google.authorize_access_token()
        user = oauth.google.userinfo()
        email = user.get("email", "").lower()
        
        logger.info(f"OAuth callback for email: {email}")
        
        if not is_authorized(email):
            logger.warning(f"Access denied for unauthorized email: {email}")
            return f"""
            <html>
                <body style="font-family: sans-serif; padding: 40px; background: #000; color: #fff; text-align: center;">
                    <h1 style="color: #ef4444;">Access Denied</h1>
                    <p>Email <strong>{email}</strong> is not authorized.</p>
                    <p>Contact the administrator to request access.</p>
                    <p><a href="/" style="color: #3b82f6;">Back</a></p>
                </body>
            </html>
            """, 403
        
        session["email"] = email
        session.permanent = True
        logger.info(f"User authenticated successfully: {email}")
        return redirect(url_for("assistant"))
    
    except Exception as e:
        logger.error(f"OAuth callback error: {e}", exc_info=True)
        return f"""
        <html>
            <body style="font-family: sans-serif; padding: 40px; background: #000; color: #fff; text-align: center;">
                <h1 style="color: #ef4444;">Login Error</h1>
                <p>{str(e)}</p>
                <p><a href="/login" style="color: #3b82f6;">Try Again</a></p>
            </body>
        </html>
        """, 500

@app.route("/logout")
def logout():
    """Logout user"""
    email = session.get("email")
    session.clear()
    logger.info(f"User logged out: {email or 'unknown'}")
    return redirect("/")

# ============================================
# MAIN ROUTES
# ============================================
@app.route("/")
def index():
    """Home page"""
    email = get_logged_in_email()
    if is_authorized(email):
        logger.info(f"Redirecting authenticated user to assistant: {email}")
        return redirect(url_for("assistant"))
    logger.info("Redirecting unauthenticated user to login")
    return redirect(url_for("login"))

@app.route("/assistant")
@require_auth
def assistant():
    """Main assistant page"""
    email = session.get("email")
    logger.info(f"Assistant page loaded for: {email}")
    return render_template("assistant.html", email=email)

@app.route("/health")
def health():
    """Health check"""
    try:
        # Test Ollama connection
        response = requests.get("http://localhost:11434/api/tags", timeout=2)
        ollama_status = "online" if response.status_code == 200 else "offline"
        logger.info(f"Health check - Ollama status: {ollama_status}")
    except requests.exceptions.ConnectionError:
        ollama_status = "offline"
        logger.warning("Health check - Ollama connection failed")
    except Exception as e:
        ollama_status = "error"
        logger.error(f"Health check error: {e}")
    
    return jsonify({
        "status": "running",
        "model": MODEL,
        "ollama": ollama_status
    })

# ============================================
# CHAT API
# ============================================
@app.route("/chat", methods=["POST"])
@require_auth
def chat():
    """
    Handle chat requests with conversation history
    Takes message, maintains context, streams response from Ollama
    """
    try:
        # Get message
        data = request.get_json()
        if not data:
            logger.error("Chat request with no JSON data")
            return jsonify({"error": "No data provided"}), 400
        
        message = data.get("message", "").strip()
        
        if not message:
            logger.error("Chat request with empty message")
            return jsonify({"error": "No message provided"}), 400
        
        email = get_logged_in_email()
        logger.info(f"Chat request from {email}: {message[:50]}...")
        
        # Initialize conversation history for this user if not exists
        if email not in conversation_histories:
            conversation_histories[email] = []
            logger.info(f"Initialized conversation history for {email}")
        
        # Add user message to history
        conversation_histories[email].append({
            "role": "user",
            "content": message
        })
        
        # Keep only last 20 messages (10 exchanges) to avoid token limits
        if len(conversation_histories[email]) > 20:
            conversation_histories[email] = conversation_histories[email][-20:]
            logger.info(f"Trimmed conversation history for {email}")
        
        # Create stream ID
        stream_id = str(uuid.uuid4())
        active_streams[stream_id] = True
        logger.info(f"Created stream ID: {stream_id}")
        
        # Prepare Ollama payload with full conversation history
        payload = {
            "model": MODEL,
            "messages": conversation_histories[email],
            "stream": True,
            "options": {
                "temperature": 0.7,
                "num_predict": 512
            }
        }
        
        logger.info(f"Sending {len(conversation_histories[email])} messages in context")
        
        def generate():
            """Stream response from Ollama"""
            full_response = ""
            try:
                logger.info(f"Connecting to Ollama at {OLLAMA_URL}")
                
                # Call Ollama
                response = requests.post(
                    OLLAMA_URL,
                    json=payload,
                    stream=True,
                    timeout=120
                )
                
                if response.status_code != 200:
                    error_msg = f"Ollama returned status {response.status_code}"
                    logger.error(error_msg)
                    yield f"data: {json.dumps({'error': error_msg})}\n\n"
                    return
                
                logger.info(f"Streaming response for stream {stream_id}")
                
                # Stream chunks
                chunk_count = 0
                for line in response.iter_lines():
                    if not line or stream_id not in active_streams:
                        if stream_id not in active_streams:
                            logger.info(f"Stream {stream_id} stopped by client")
                        break
                    
                    try:
                        chunk_data = json.loads(line)
                        chunk_count += 1
                        
                        # Send content chunk
                        if "message" in chunk_data and "content" in chunk_data["message"]:
                            content = chunk_data["message"]["content"]
                            if content:
                                full_response += content
                                yield f"data: {json.dumps({'content': content})}\n\n"
                        
                        # Check if done
                        if chunk_data.get("done", False):
                            logger.info(f"Stream {stream_id} completed - {chunk_count} chunks")
                            
                            # Add assistant response to history
                            if full_response and email in conversation_histories:
                                conversation_histories[email].append({
                                    "role": "assistant",
                                    "content": full_response
                                })
                                logger.info(f"Saved assistant response to history for {email}")
                            
                            yield f"data: {json.dumps({'done': True})}\n\n"
                            break
                    
                    except json.JSONDecodeError as e:
                        logger.warning(f"Failed to parse chunk: {e}")
                        continue
                
            except requests.exceptions.ConnectionError as e:
                error_msg = "Cannot connect to Ollama. Is it running?"
                logger.error(f"Connection error: {e}")
                yield f"data: {json.dumps({'error': error_msg})}\n\n"
            
            except requests.exceptions.Timeout as e:
                error_msg = "Request timeout. Model might be too slow."
                logger.error(f"Timeout error: {e}")
                yield f"data: {json.dumps({'error': error_msg})}\n\n"
            
            except Exception as e:
                error_msg = f"Unexpected error: {str(e)}"
                logger.error(f"Stream error: {e}", exc_info=True)
                yield f"data: {json.dumps({'error': error_msg})}\n\n"
            
            finally:
                # Cleanup
                if stream_id in active_streams:
                    del active_streams[stream_id]
                    logger.info(f"Cleaned up stream {stream_id}")
        
        return Response(generate(), mimetype="text/event-stream")
    
    except Exception as e:
        logger.error(f"Chat endpoint error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route("/stop_stream/<stream_id>", methods=["POST"])
@require_auth
def stop_stream(stream_id):
    """Stop a streaming response"""
    if stream_id in active_streams:
        del active_streams[stream_id]
        logger.info(f"Stream stopped: {stream_id}")
    return jsonify({"stopped": True})

@app.route("/clear_history", methods=["POST"])
@require_auth
def clear_history():
    """Clear conversation history for current user"""
    email = get_logged_in_email()
    if email in conversation_histories:
        del conversation_histories[email]
        logger.info(f"Cleared conversation history for {email}")
    return jsonify({"cleared": True})

# ============================================
# ERROR HANDLERS
# ============================================
@app.errorhandler(404)
def not_found(e):
    logger.warning(f"404 error: {request.url}")
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(e):
    logger.error(f"500 error: {e}", exc_info=True)
    return jsonify({"error": "Internal server error"}), 500

# ============================================
# RUN
# ============================================
if __name__ == "__main__":
    print("\n" + "="*60)
    print("LIGHT ASSISTANT")
    print("="*60)
    print(f"Model: {MODEL}")
    print(f"Authorized: {', '.join(ALLOWED_EMAILS_LIST)}")
    print("="*60 + "\n")
    
    # Test Ollama connection
    try:
        logger.info("Testing Ollama connection...")
        test = requests.get("http://localhost:11434/api/tags", timeout=2)
        if test.status_code == 200:
            print("[OK] Ollama is running")
            logger.info("Ollama connection successful")
        else:
            print(f"[WARNING] Ollama returned status {test.status_code}")
            logger.warning(f"Ollama connection issue: status {test.status_code}")
    except requests.exceptions.ConnectionError:
        print("[ERROR] Ollama not running! Start with: ollama serve")
        logger.error("Ollama is not running")
    except Exception as e:
        print(f"[ERROR] Ollama test failed: {e}")
        logger.error(f"Ollama test error: {e}")
    
    print("\nStarting server on http://127.0.0.1:5050\n")
    logger.info("Starting Flask server")
    
    host = "0.0.0.0" if os.getenv("PRODUCTION") else "127.0.0.1"
    app.run(host=host, port=5050, debug=False, threaded=True)