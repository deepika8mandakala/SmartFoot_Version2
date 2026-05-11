from flask import Flask

app = Flask(__name__)

@app.route("/api")
def home():
    return "SmartFoot API running!"

# Vercel entrypoint
def handler(request):
    return app
