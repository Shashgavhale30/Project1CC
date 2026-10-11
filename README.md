# Student Information Management System

A three-tier cloud web application for managing student records.

**Stack:** React (CDN) + Node.js/Express + MongoDB Atlas  
**Deployed on:** Netlify (frontend) · Render (backend) · MongoDB Atlas (database)

---

## How it works

```
Browser → Netlify (static frontend) → Render (REST API) → MongoDB Atlas (database)
```

The frontend never connects to the database directly. All data goes through the backend API.

---

## Local Setup

```bash
# 1. Clone and install
git clone https://github.com/Shashgavhale30/Project1CC.git
cd Project1CC/backend
npm install

# 2. Create backend/.env with these variables:
#    MONGODB_URI = your MongoDB Atlas connection string
#    FRONTEND_URL = http://localhost:3000,http://127.0.0.1:5500
#    PORT = 5000

# 3. Start the backend
npm start

# 4. Open frontend/index.html in your browser
```

---

## Environment Variables (backend/.env)

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | Atlas connection string — `mongodb+srv://user:pass@cluster.mongodb.net/studentDB` |
| `FRONTEND_URL` | Allowed origin(s), comma-separated, no trailing slash |
| `PORT` | Server port (Render sets this automatically) |

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Health check |
| GET | `/api/students` | Get all students |
| GET | `/api/students?search=name` | Search by name |
| GET | `/api/students/:id` | Get one student |
| POST | `/api/students` | Add a student |
| PUT | `/api/students/:id` | Update a student |
| DELETE | `/api/students/:id` | Delete a student |

---

## Deployment

1. **MongoDB Atlas** — create a free M0 cluster, add a DB user, allow all IPs (`0.0.0.0/0`), copy connection string.

2. **Render** — new Web Service from this repo:
   - Root directory: `backend`
   - Build: `npm install` · Start: `npm start`
   - Env vars: `MONGODB_URI` and `FRONTEND_URL`
   - `FRONTEND_URL` should be your Netlify origin, for example `https://project1cc.netlify.app`

3. **Update** `const API` in `frontend/script.js` to your Render URL, commit and push.

4. **Netlify** — import repo, base dir `frontend`, publish dir `frontend`, no build command.

5. **Update** `FRONTEND_URL` on Render to your Netlify URL (no trailing slash), then redeploy the backend.
