from flask import Flask, request, jsonify
from flask_cors import CORS
import spacy
from dateutil.parser import parse as parse_date

app = Flask(__name__)
CORS(app, resources={r"/parse": {"origins": "chrome-extension://*"}})
nlp = spacy.load("en_core_web_lg")

def parse_message(text):
    doc = nlp(text.lower())
    slots = []
    current_slot = {"day": "unknown", "start": "any", "end": "any"}

    for ent in doc.ents:
        if ent.label_ == "DATE":
            if current_slot["start"] != "any":
                slots.append(current_slot)
            try:
                parsed_date = parse_date(ent.text, fuzzy=True, dayfirst=False)
                current_slot = {"day": parsed_date.strftime("%A"), "start": "any", "end": "any"}
            except ValueError:
                current_slot = {"day": ent.text, "start": "any", "end": "any"}
        elif ent.label_ == "TIME":
            time_str = ent.text.replace(" ", "").lower()
            if "to" in [t.text for t in doc[ent.start:ent.start+2]] and len(doc) > ent.start + 2:
                current_slot["start"] = time_str
                next_ent = doc[ent.start + 2]
                if next_ent.ent_type_ == "TIME":
                    current_slot["end"] = next_ent.text.replace(" ", "").lower()
            else:
                current_slot["start"] = time_str
                current_slot["end"] = "any"

    for token in doc:
        if token.text in ["morning", "afternoon", "evening"] and current_slot["start"] == "any":
            if token.text == "morning":
                current_slot["start"] = "9:00am"
                current_slot["end"] = "12:00pm"
            elif token.text == "afternoon":
                current_slot["start"] = "1:00pm"
                current_slot["end"] = "5:00pm"
            elif token.text == "evening":
                current_slot["start"] = "6:00pm"
                current_slot["end"] = "9:00pm"

    if current_slot["day"] != "unknown" or current_slot["start"] != "any":
        slots.append(current_slot)
    if not slots:
        slots.append({"day": "unknown", "start": "any", "end": "any"})
    
    return {"slots": slots}

@app.route("/parse", methods=["POST"])
def parse():
    text = request.json.get("text", "")
    result = parse_message(text)
    print("Parsed input:", text, "->", result)
    return jsonify(result)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)