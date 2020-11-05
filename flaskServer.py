from flask import Flask, render_template

app = Flask(__name__)


@app.route("/home")
@app.route("/")
def home():
    return render_template("index.html")


def runServer():
    app.run(debug=True)
