# ============================================================================
# LIGHT ASSISTANT - Complete Rewrite
# Open access, per-user storage, modern architecture
# ============================================================================

import os
import secrets
import json
import logging
import base64
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from flask import Flask, redirect, url_for, session, render_template, request, jsonify, Response
from authlib.integrations.flask_client import OAuth
from flask_cors import CORS
import requests

# Load environment variables
load_dotenv()

# ============================================
# LOGGING
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
FLASK_SECRET_KEY = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32))

# Ollama settings
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
MODEL = os.getenv("MODEL", "llama3:latest")

# URLs
PRODUCTION_URL = os.getenv("PRODUCTION_URL", "https://assistant.itslightning.online")
LOCAL_URL = "http://127.0.0.1:5050"

# Data directory
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

logger.info(f"Configuration loaded. Model: {MODEL}")
logger.info(f"Data directory: {DATA_DIR.absolute()}")

# ============================================
# FLASK SETUP
# ============================================
app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY
app.permanent_session_lifetime = timedelta(days=30)
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

# ============================================
# USER STORAGE
# ============================================
class UserStorage:
    """Manages per-user conversation storage"""
    
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
    
    def get_user_dir(self, email: str) -> Path:
        """Get or create user directory"""
        # Sanitize email for folder name
        safe_email = email.replace("@", "_at_").replace(".", "_")
        user_dir = self.data_dir / safe_email
        user_dir.mkdir(exist_ok=True)
        return user_dir
    
    def get_conversations_file(self, email: str) -> Path:
        """Get path to user's conversations file"""
        return self.get_user_dir(email) / "conversations.json"
    
    def load_conversations(self, email: str) -> list:
        """Load user's conversations"""
        conv_file = self.get_conversations_file(email)
        
        if not conv_file.exists():
            return []
        
        try:
            with open(conv_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('conversations', [])
        except Exception as e:
            logger.error(f"Error loading conversations for {email}: {e}")
            return []
    
    def save_conversations(self, email: str, conversations: list):
        """Save user's conversations"""
        conv_file = self.get_conversations_file(email)
        
        try:
            with open(conv_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'email': email,
                    'updated_at': datetime.now().isoformat(),
                    'conversations': conversations
                }, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved {len(conversations)} conversations for {email}")
        except Exception as e:
            logger.error(f"Error saving conversations for {email}: {e}")
    
    def get_active_conversation(self, email: str) -> dict:
        """Get user's active conversation"""
        conversations = self.load_conversations(email)
        
        # Find or create active conversation
        for conv in conversations:
            if conv.get('is_active', False):
                return conv
        
        # Create new active conversation
        new_conv = {
            'id': secrets.token_hex(8),
            'title': 'New Conversation',
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'is_active': True,
            'messages': []
        }
        conversations.insert(0, new_conv)
        self.save_conversations(email, conversations)
        return new_conv
    
    def update_conversation(self, email: str, conv_id: str, messages: list):
        """Update a conversation's messages"""
        conversations = self.load_conversations(email)
        
        for conv in conversations:
            if conv['id'] == conv_id:
                conv['messages'] = messages
                conv['updated_at'] = datetime.now().isoformat()
                
                # Update title based on first message
                if len(messages) > 0 and conv['title'] == 'New Conversation':
                    first_msg = next((m for m in messages if m['role'] == 'user'), None)
                    if first_msg:
                        conv['title'] = first_msg['content'][:50] + ('...' if len(first_msg['content']) > 50 else '')
                
                break
        
        self.save_conversations(email, conversations)
    
    def create_new_conversation(self, email: str) -> dict:
        """Create a new conversation and set it as active"""
        conversations = self.load_conversations(email)
        
        # Deactivate all conversations
        for conv in conversations:
            conv['is_active'] = False
        
        # Create new active conversation
        new_conv = {
            'id': secrets.token_hex(8),
            'title': 'New Conversation',
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'is_active': True,
            'messages': []
        }
        
        conversations.insert(0, new_conv)
        self.save_conversations(email, conversations)
        return new_conv
    
    def set_active_conversation(self, email: str, conv_id: str) -> bool:
        """Set a conversation as active"""
        conversations = self.load_conversations(email)
        
        found = False
        for conv in conversations:
            conv['is_active'] = (conv['id'] == conv_id)
            if conv['id'] == conv_id:
                found = True
        
        if found:
            self.save_conversations(email, conversations)
        
        return found
    
    def delete_conversation(self, email: str, conv_id: str) -> bool:
        """Delete a conversation"""
        conversations = self.load_conversations(email)
        
        # Find and remove
        conversations = [c for c in conversations if c['id'] != conv_id]
        
        # If we deleted the active conversation, make the first one active
        has_active = any(c.get('is_active', False) for c in conversations)
        if not has_active and conversations:
            conversations[0]['is_active'] = True
        
        self.save_conversations(email, conversations)
        return True

storage = UserStorage(DATA_DIR)

# ============================================
# HELPER FUNCTIONS
# ============================================
def get_logged_in_email():
    """Get current logged-in email"""
    return session.get("email")

def require_auth(f):
    """Decorator to require authentication"""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        email = get_logged_in_email()
        if not email:
            logger.warning("Unauthorized access attempt")
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
        return render_template("error.html", 
            title="Login Error",
            message=str(e)
        ), 500

@app.route("/auth/callback")
def auth_callback():
    """Handle OAuth callback"""
    try:
        logger.info("Processing OAuth callback")
        token = oauth.google.authorize_access_token()
        user = oauth.google.userinfo()
        email = user.get("email", "").lower()
        name = user.get("name", "")
        
        logger.info(f"OAuth successful for: {email}")
        
        # Store user info in session
        session["email"] = email
        session["name"] = name
        session.permanent = True
        
        # Initialize user storage
        storage.get_user_dir(email)
        
        logger.info(f"User authenticated: {email}")
        return redirect(url_for("assistant"))
    
    except Exception as e:
        logger.error(f"OAuth callback error: {e}", exc_info=True)
        return render_template("error.html",
            title="Authentication Error",
            message=str(e)
        ), 500

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
    if email:
        return redirect(url_for("assistant"))
    return redirect(url_for("login"))

@app.route("/assistant")
@require_auth
def assistant():
    """Main assistant page"""
    email = session.get("email")
    name = session.get("name", "User")
    logger.info(f"Assistant page loaded for: {email}")
    return render_template("assistant.html", email=email, name=name)

@app.route("/health")
def health():
    """Health check"""
    try:
        response = requests.get("http://localhost:11434/api/tags", timeout=2)
        ollama_status = "online" if response.status_code == 200 else "offline"
    except:
        ollama_status = "offline"
    
    return jsonify({
        "status": "running",
        "model": MODEL,
        "ollama": ollama_status
    })

# ============================================
# CONVERSATION API
# ============================================
@app.route("/api/conversations", methods=["GET"])
@require_auth
def get_conversations():
    """Get user's conversations"""
    email = get_logged_in_email()
    conversations = storage.load_conversations(email)
    return jsonify({"conversations": conversations})

@app.route("/api/conversations/active", methods=["GET"])
@require_auth
def get_active_conversation():
    """Get active conversation"""
    email = get_logged_in_email()
    conv = storage.get_active_conversation(email)
    return jsonify(conv)

@app.route("/api/conversations/new", methods=["POST"])
@require_auth
def new_conversation():
    """Create new conversation"""
    email = get_logged_in_email()
    conv = storage.create_new_conversation(email)
    return jsonify(conv)

@app.route("/api/conversations/<conv_id>/activate", methods=["POST"])
@require_auth
def activate_conversation(conv_id):
    """Set conversation as active"""
    email = get_logged_in_email()
    success = storage.set_active_conversation(email, conv_id)
    
    if success:
        conv = storage.get_active_conversation(email)
        return jsonify(conv)
    else:
        return jsonify({"error": "Conversation not found"}), 404

@app.route("/api/conversations/<conv_id>", methods=["DELETE"])
@require_auth
def delete_conversation(conv_id):
    """Delete conversation"""
    email = get_logged_in_email()
    storage.delete_conversation(email, conv_id)
    return jsonify({"success": True})

# ============================================
# CHAT API
# ============================================
@app.route("/api/chat", methods=["POST"])
@require_auth
def chat():
    """Handle chat requests"""
    try:
        data = request.get_json()
        message = data.get("message", "").strip()
        
        if not message:
            return jsonify({"error": "No message provided"}), 400
        
        email = get_logged_in_email()
        logger.info(f"Chat request from {email}: {message[:50]}...")
        
        # Get active conversation
        conv = storage.get_active_conversation(email)
        messages = conv.get('messages', [])
        
        # Add user message
        messages.append({
            "role": "user",
            "content": message,
            "timestamp": datetime.now().isoformat()
        })
        
        # Keep last 20 messages for context
        context_messages = messages[-20:]
        
        # Prepare Ollama payload with system prompt for concise responses
        ollama_messages = [
            {
                "role": "system",
                "content": "You are Light, a helpful AI assistant. Keep your responses concise and to the point. Aim for 2-4 sentences unless the user specifically asks for a detailed explanation. Be friendly but brief."
            }
        ]
        ollama_messages.extend([{"role": m["role"], "content": m["content"]} for m in context_messages])
        
        payload = {
            "model": MODEL,
            "messages": ollama_messages,
            "stream": True,
            "options": {
                "temperature": 0.7,
                "num_predict": 256  # Shorter responses
            }
        }
        
        def generate():
            """Stream response from Ollama"""
            full_response = ""
            
            try:
                response = requests.post(
                    OLLAMA_URL,
                    json=payload,
                    stream=True,
                    timeout=120
                )
                
                if response.status_code != 200:
                    yield f"data: {json.dumps({'error': f'Ollama error: {response.status_code}'})}\n\n"
                    return
                
                for line in response.iter_lines():
                    if not line:
                        continue
                    
                    try:
                        chunk_data = json.loads(line)
                        
                        if "message" in chunk_data and "content" in chunk_data["message"]:
                            content = chunk_data["message"]["content"]
                            if content:
                                full_response += content
                                yield f"data: {json.dumps({'content': content})}\n\n"
                        
                        if chunk_data.get("done", False):
                            # Add assistant response to messages
                            messages.append({
                                "role": "assistant",
                                "content": full_response,
                                "timestamp": datetime.now().isoformat()
                            })
                            
                            # Save updated conversation
                            storage.update_conversation(email, conv['id'], messages)
                            
                            yield f"data: {json.dumps({'done': True})}\n\n"
                            break
                    
                    except json.JSONDecodeError:
                        continue
            
            except Exception as e:
                logger.error(f"Stream error: {e}", exc_info=True)
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        return Response(generate(), mimetype="text/event-stream")
    
    except Exception as e:
        logger.error(f"Chat endpoint error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

# ============================================
# ERROR HANDLERS
# ============================================
@app.errorhandler(404)
def not_found(e):
    return render_template("error.html", 
        title="Not Found",
        message="The page you're looking for doesn't exist."
    ), 404

@app.errorhandler(500)
def internal_error(e):
    return render_template("error.html",
        title="Server Error", 
        message="Something went wrong on our end."
    ), 500

# ============================================
# RUN
# ============================================
if __name__ == "__main__":
    print("\n" + "="*60)
    print("LIGHT ASSISTANT - V2")
    print("="*60)
    print(f"Model: {MODEL}")
    print(f"Data Directory: {DATA_DIR.absolute()}")
    print("="*60 + "\n")
    
    # Test Ollama
    try:
        test = requests.get("http://localhost:11434/api/tags", timeout=2)
        print("[✓] Ollama is running" if test.status_code == 200 else "[!] Ollama issue")
    except:
        print("[✗] Ollama not running! Start with: ollama serve")
    
    print("\nStarting server on http://127.0.0.1:5050\n")
    
    host = "0.0.0.0" if os.getenv("PRODUCTION") else "127.0.0.1"
    app.run(host=host, port=5050, debug=False, threaded=True)