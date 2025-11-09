# QuitCoach – AI & Gamification for Smoking Cessation

A production‑ready Progressive Web App that helps people quit smoking. Users log cravings and daily status, earn badges, 
get data‑driven insights, and receive daily challenges and push reminders. The backend provides secure APIs, AI‑assisted 
coaching (Groq via LangChain), and scheduled push notifications. This project was developed as part of a postgraduate thesis 
to explore how **AI-Enhanced and Gamified design** can enhance **User Engagement and Behavior Change** in health applications.

Developed by **Kyriakos Papoutsis**

Bachelor of Science (BSc) in Digital Systems
*Specialization: Software and Data Systems*  
*Secondary Track: Information Systems*  
Department of Digital Systems, University of Piraeus

---

**Stack**: React + Vite + Tailwind + PWA • Firebase (Auth, Firestore, Storage, Messaging) • Express (Node) •
LangChain + Groq • Capacitor (optional native wrapper)

---

## 📱 Screenshots

Below are selected screenshots from the **QuitCoach** app, showcasing its main features, UI, and gamification system.

> The app includes over 40 unique views and components.  
> For clarity, screenshots are grouped by category.

---

### 🏠 Dashboard & User Overview
<p align="center">
  <img src="docs/screenshots/dashboard-1.png" width="200" />
  <img src="docs/screenshots/dashboard-2.png" width="200" />
  <img src="docs/screenshots/dashboard-3.png" width="200" />
  <img src="docs/screenshots/dashboard-4.png" width="200" />
  <img src="docs/screenshots/dashboard-5.png" width="200" />
  <img src="docs/screenshots/dashboard-6.png" width="200" />
  <img src="docs/screenshots/dashboard-7.png" width="200" />
</p>

---

### 👤 Profile & Customization
<p align="center">
  <img src="docs/screenshots/profile-1.png" width="200" />
  <img src="docs/screenshots/profile-2.png" width="200" />
  <img src="docs/screenshots/profile-3.png" width="200" />
  <img src="docs/screenshots/profile-4.png" width="200" />
  <img src="docs/screenshots/profile-pic-selector.png" width="200" />
</p>

---

### 🤖 AI Coach & Chat Interface
<p align="center">
  <img src="docs/screenshots/chat-1.png" width="200" />
  <img src="docs/screenshots/chat-2.png" width="200" />
  <img src="docs/screenshots/chat-3.png" width="200" />
  <img src="docs/screenshots/chat-4.png" width="200" />
  <img src="docs/screenshots/chat-5.png" width="200" />
  <img src="docs/screenshots/chat-6.png" width="200" />
</p>

---

### 🧩 Daily Challenges & History
<p align="center">
  <img src="docs/screenshots/challenges-1.png" width="200" />
  <img src="docs/screenshots/challenges-2.png" width="200" />
  <img src="docs/screenshots/challenges-3.png" width="200" />
</p>

---

### 🏅 Badges, Progress & Gamification
<p align="center">
  <img src="docs/screenshots/badges-1.png" width="200" />
  <img src="docs/screenshots/badges-2.png" width="200" />
  <img src="docs/screenshots/badges-3.png" width="200" />
  <img src="docs/screenshots/badges-4.png" width="200" />
  <img src="docs/screenshots/badges-5.png" width="200" />
  <img src="docs/screenshots/badges-6.png" width="200" />
  <img src="docs/screenshots/badges-7.png" width="200" />
  <img src="docs/screenshots/badges-8.png" width="200" />
  <img src="docs/screenshots/all-badges.png" width="300" />
</p>

---

### 🗓️ Daily Log & Report Card
<p align="center">
  <img src="docs/screenshots/dailylog-1.png" width="200" />
  <img src="docs/screenshots/dailylog-2.png" width="200" />
  <img src="docs/screenshots/dailylog-3.png" width="200" />
  <img src="docs/screenshots/dailylog-reportcard-1.png" width="200" />
  <img src="docs/screenshots/dailylog-reportcard-2.png" width="200" />
  <img src="docs/screenshots/dailylog-reportcard-3.png" width="200" />
  <img src="docs/screenshots/dailylog-reportcard-4.png" width="200" />
</p>

---

### 🔔 Leaderboards & Community
<p align="center">
  <img src="docs/screenshots/leaderboard-1.png" width="200" />
  <img src="docs/screenshots/leaderboard-2.png" width="200" />
  <img src="docs/screenshots/leaderboard-3.png" width="200" />
  <img src="docs/screenshots/community.png" width="200" />
  <img src="docs/screenshots/motivation-wall-1.png" width="200" />
  <img src="docs/screenshots/motivation-wall-2.png" width="200" />
  <img src="docs/screenshots/motivation-wall-3.png" width="200" />
  <img src="docs/screenshots/motivation-wall-4.png" width="200" />
</p>

---

### 📱 Additional Screens (Sign In, Sign Up, Notifications)
<p align="center">
  <img src="docs/screenshots/signin.png" width="200" />
  <img src="docs/screenshots/signup.png" width="200" />
  <img src="docs/screenshots/notifications.png" width="200" />
</p>

---

> 💡 *All screenshots are from the development build of the QuitCoach PWA and serve academic demonstration purposes.*

---

## ✨ Key Features

- **Daily Challenges:** AI-generated and curated goals to build healthy habits  
- **AI Coach:** Chat-based assistant offering motivational and behavioral support  
- **Badges & Progress Tracking:** Earn achievements as milestones are reached  
- **Push Notifications:** Personalized reminders and challenge alerts  
- **PWA:** Installable on mobile or desktop, with some offline functionality
- **Mobile‑ready** — Capacitor project scaffolding for Android/iOS
- **Gamified Motivation Loop:** Points, badges, community leaderboards and progress visualization  

---

## 🏗️ Tech Stack

| Layer | Technologies |
|-------|---------------|
| **Frontend** | React + Vite + Tailwind CSS + PWA (vite-plugin-pwa) |
| **Backend** | Node.js + Express |
| **Database & Auth** | Firebase (Auth + Firestore) |
| **AI Integration** | LangChain + Groq API |
| **Push Notifications** | Firebase Cloud Messaging (FCM) |
| **Mobile Build (optional)** | Capacitor for Android/iOS |
| **Other Tools** | Concurrently, ESLint, PostCSS, Tailwind, npm scripts |

---

## 🧩 Architecture Overview
Frontend (React/Vite/PWA)
│
├── Firebase Auth & Firestore
│
├── Express Backend (Node)
│ ├── /api/push/ → Push registration & sending
│ ├── /api/ai/coach → AI challenge generation & chat
│
└── Scheduler (node-cron)
├── Daily challenge generation
└── Reminder notifications

---

## 🧰 Development Notes

For privacy and safety:
- API keys, Firebase credentials, and service account JSONs are **not included**.
- `.env` files are excluded; only `.env.example` is provided.
- Native mobile folders (`android/`, `ios/`) can be regenerated via Capacitor if needed.

This repository is published **for academic and demonstration purposes only** and is **not intended for public deployment or production use**.

---

QuitCoach-AI-Gamification/
│
├── public/ → App assets, icons, manifest, sounds
├── src/ → Frontend React components
│ ├── pages/ → App screens (Dashboard, AIChat, etc.)
│ ├── components/ → Reusable UI components
│ ├── services/ → Firestore & logic modules
│ └── firebase.js → Firebase initialization (env-based)
│
├── server/ → Express backend (AI & push services)
├── challenges_catalog.json → Challenge seed data
├── seed_challenges.cjs → Script for seeding Firestore
├── capacitor.config.ts → Capacitor project config
├── vite.config.js → Vite + PWA setup
├── tailwind.config.cjs → Tailwind setup
└── .env.example → Template of environment variables

---

## ⚙️ (Optional) How to Run Locally

> ⚠️ **Note:** The app requires Firebase and API keys to function fully.  
> This section is for academic reviewers or developers testing locally.

### 1️⃣ Prerequisites
- Node.js 18+
- Firebase project (Auth + Firestore)
- `.env` file configured from `.env.example`
- GROQ API key (optional for AI features)

### 2️⃣ Install dependencies
npm install

### 3️⃣ Start the backend and frontend
# Start both at once
npm run dev:all

---

🧠 Potential Future Enhancements
Integration with wearable devices (steps, heart rate)
Expanded AI conversation flow for deeper behavioral coaching
Cooperative goals and sharing achievements with the Community

---

Contact: kyriakosiam@outlook.com
