<img src="https://github.com/yashknight007/MeetAI-Basis_Vectors/blob/b6d225f5d9797a4228306f8ab69c0577bc80cd58/icon.png" width="100" alt="logo">

# MEET.AI 🤖
## Hello👋 ! Ever felt stuck while Coordinating Interviews for High Volume hiring which is inefficient & Time Consuming ? Here we are with our MEET.AI 🤖 chrome extension to help Recruiters and Candidates.

## ✅ Secured by Google OAuth2.0 🔒 
To seamlessly sync meetings and schedule them with Recruiters and Candidates with security, We used Google OAuth2.0. 

## ✅ Availability Parsing with NLP 🧠 
Used Spacy NLP to find the availability of Candidates to schedule with the Recruiters available time slots for meetings.

## ✅ Sends Calendar invites automatiaclly 📅 
Finds available time slots from recruiters free schedule and sends calendar invites to both the parties.

##  🏗 Tech Stack 
- **Frontend:** HTML, CSS(Tailwind), JavaScript 
- **Backend:** Flask (Python)
- **NLP Model:** Spacy

## 🛠 Installation Guide
🔹 1. Clone the Repository  
```sh
git clone https://github.com/yashknight007/MeetAI-Basis_Vectors
```
🔹 2. Install Dependencies
```sh
pip install flask flask-cors spacy python-dateutil
python -m spacy download en_core_web_lg
```
🔹 3. Run the Flask Server
```sh
python server.py
```
🔹 4. 👉 Replace your Google OAuth Client Id in Manifest.json 

🔹 5. Load the Extension in Chrome:
- Open chrome://extensions/.
- Enable "Developer mode".
- Click "Load unpacked" and select the MeetAI-Basis_Vectors folder.
- 🚀Voila! Enjoy seamless recruitment..

## 🎥 Project Demo
🔗 [Watch Demo on Google Drive](https://drive.google.com/file/d/1-5PKonYMXWtW-z3t2LXBXcvmsTsUP1ft/view?usp=sharing)










