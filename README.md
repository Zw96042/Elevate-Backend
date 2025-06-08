# Elevate Backend

The backend server powering the **Elevate** mobile app. Built with **Express** and tools like **Puppeteer** and **Cheerio**, it interfaces with Skyward to serve grades, assignments, and messages via REST APIs.

🔗 **Frontend Repo**: [Elevate-Frontend](https://github.com/Zw96042/Elevate-Frontend)  
📋 **Project Board**: [GitHub Project Tracker](https://github.com/users/Zw96042/projects/2)

---

## 🚀 Project Vision

Elevate redefines the student grade tracking experience. The backend securely:

- Authenticates users with Skyward credentials
- Scrapes and parses data from Skyward portals
- Returns grades, assignments, and inbox messages via API
- Powers GPA calculations and calendar syncing in the frontend

---

## 🛠️ Tech Stack

- **Node.js**
- **Express.js** (v5)
- **Axios** with cookie jar support
- **dotenv** for config
- **Puppeteer** for headless scraping
- **Cheerio** and **node-html-parser** for HTML parsing
- **CORS** for secure frontend integration
- **tough-cookie** for session management

> ⚠️ HTTPS is not currently implemented, pending domain + SSL support.

---

## 📂 File Structure
```
Elevate-Backend/
├── src/
│   ├── auth.js             # Handles Skyward login/authentication
│   ├── extract.js          # Utility functions for scraping/parsing
│   ├── grades.js           # Endpoint logic for /grades
│   ├── messages.js         # Endpoint logic for /messages
├── server.js               # App entry point
├── .env                    # Secrets and environment variables
└── package.json
```
---

## 🔌 API Endpoints (WIP)

| Method | Route             | Description                           |
|--------|------------------|---------------------------------------|
| POST   | `/auth`          | Logs in and returns session info      |
| GET    | `/grades`        | Fetches current grades                |
| GET    | `/messages`      | Retrieves top inbox messages          |
| GET    | `/next-messages` | Retrieves following inbox messages    |

---

## ✅ Current Development

To view what I’m currently working on, check:  
🔗 [Elevate Project Board](https://github.com/users/Zw96042/projects/2)

---

## 🐛 Bug Reports & Suggestions

If you encounter a bug, have a feature idea, or want to contribute:

Open an issue on [this repository](https://github.com/Zw96042/Elevate-Backend/issues)

---

## 📬 Contact

Maintained by Zachary Wilson  
📧 [zach.wilson.atx@gmail.com](mailto:zach.wilson.atx@gmail.com)