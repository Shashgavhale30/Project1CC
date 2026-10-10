# 🎓 Student Information Management System

A **three-tier cloud web application** built for a college Cloud Computing mini project.  
Demonstrates a complete request flow: Browser → Netlify (Frontend) → Render (Backend API) → MongoDB Atlas (Database).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        REQUEST FLOW                             │
│                                                                 │
│  ┌──────────────┐   fetch()    ┌──────────────┐  Mongoose  ┌──────────────┐ │
│  │   TIER  1    │ ──────────▶  │   TIER  2    │ ─────────▶ │   TIER  3    │ │
│  │   Frontend   │             │   Backend    │            │   Database   │ │
│  │   HTML/CSS/  │ ◀──────────  │   Node.js +  │ ◀───────── │  MongoDB     │ │
│  │   JS         │   JSON       │   Express    │  JSON docs │  Atlas       │ │
│  │              │              │              │            │              │ │
│  │  Netlify CDN │              │  Render.com  │            │  Atlas M0    │ │
│  └──────────────┘              └──────────────┘            └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Tier | Technology | Platform |
|------|-----------|----------|
| Frontend | HTML5, CSS3, JavaScript (Vanilla) | Netlify |
| Backend  | Node.js v18+, Express v4, CORS, dotenv | Render |
| Database | MongoDB Atlas (M0 free cluster), Mongoose v8 | MongoDB Atlas |

---

## Environment Variables

> ⚠️ **Never commit `.env` to Git.** Use `.env.example` as a template.

### Backend (`backend/.env`)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `MONGODB_URI` | ✅ Yes | Full Atlas connection string with DB name | `mongodb+srv://user:pass@cluster.mongodb.net/studentDB?retryWrites=true&w=majority` |
| `FRONTEND_URL` | ✅ Yes | Comma-separated list of allowed CORS origins (no trailing slash) | `https://your-app.netlify.app` |
| `PORT` | Optional | Port for Express (Render sets this automatically) | `5000` |

---

## Local Setup

### Prerequisites
- Node.js v18+ (check: `node -v`)
- A MongoDB Atlas account (free)
- Git

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/<your-username>/student-system.git
cd student-system

# 2. Install backend dependencies
cd backend
npm install

# 3. Create your local .env from the template
copy .env.example .env      # Windows
# cp .env.example .env      # Mac/Linux

# 4. Edit backend/.env and fill in:
#    MONGODB_URI = your Atlas connection string (see Atlas setup below)
#    FRONTEND_URL = http://localhost:3000,http://127.0.0.1:5500
#    PORT = 5000

# 5. Start the backend
npm start
# Should print: ✅ Connected to MongoDB Atlas
#               🚀 Server running on port 5000

# 6. Open frontend/index.html in a browser (use Live Server in VS Code,
#    or just open the file directly — both work for local testing)
```

---

## API Endpoint Reference

Base URL (local): `http://localhost:5000`  
Base URL (production): `https://<your-service>.onrender.com`

| Method | Endpoint | Description | Success | Error |
|--------|----------|-------------|---------|-------|
| GET | `/` | Health check | 200 | — |
| GET | `/api/students` | List all students | 200 `[...]` | 500 |
| GET | `/api/students?search=rahul` | Search by name (case-insensitive) | 200 `[...]` | 500 |
| GET | `/api/students/:id` | Get one student by studentId | 200 `{...}` | 404 |
| POST | `/api/students` | Create a new student | 201 `{...}` | 400, 409, 500 |
| PUT | `/api/students/:id` | Update student by studentId | 200 `{...}` | 400, 404, 500 |
| DELETE | `/api/students/:id` | Delete student by studentId | 200 `{message}` | 404, 500 |

### Example Requests (curl)

```bash
# Health check
curl http://localhost:5000/

# Add a student
curl -X POST http://localhost:5000/api/students \
  -H "Content-Type: application/json" \
  -d '{"studentId":"ST101","name":"Rahul Sharma","email":"rahul@example.com","department":"CSE","semester":5,"contact":"+91 9876543210"}'

# List all students
curl http://localhost:5000/api/students

# Search by name
curl "http://localhost:5000/api/students?search=rahul"

# Update a student
curl -X PUT http://localhost:5000/api/students/ST101 \
  -H "Content-Type: application/json" \
  -d '{"semester":6}'

# Delete a student
curl -X DELETE http://localhost:5000/api/students/ST101
```

---

## Deployment Steps

### Step 1 — MongoDB Atlas (Tier 3)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) and sign in / register.
2. Click **Build a Database** → **Free (M0)** → choose a region near you.
3. **Create a database user**:
   - Username: `studentUser` (or similar)
   - Password: alphanumeric only (e.g., `Pass1234`) — avoid special chars
4. **Network Access** → Add IP Address → `0.0.0.0/0` (allow all — required for Render)
5. **Connect** → **Drivers** → copy the connection string.
6. Replace `<password>` and set the database name to `studentDB`:
   ```
   mongodb+srv://studentUser:Pass1234@cluster0.xxxxx.mongodb.net/studentDB?retryWrites=true&w=majority
   ```

---

### Step 2 — Render (Tier 2 Backend)

1. Go to [render.com](https://render.com) and sign in with GitHub.
2. **New** → **Web Service** → connect your GitHub repo.
3. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Runtime**: Node
4. Add **Environment Variables**:
   - `MONGODB_URI` = your Atlas connection string
   - `FRONTEND_URL` = `https://your-app.netlify.app` *(set after Netlify deploy)*
5. Click **Deploy**. Wait for "Connected to MongoDB Atlas" in the logs.
6. Copy your Render URL: `https://student-system-xxxx.onrender.com`

---

### Step 3 — Update API URL in Frontend

After you have the Render URL:

```js
// In frontend/script.js — change line 10 from:
const API = "http://localhost:5000/api/students";
// to:
const API = "https://student-system-xxxx.onrender.com/api/students";
```

Commit and push this change.

---

### Step 4 — Netlify (Tier 1 Frontend)

1. Go to [netlify.com](https://netlify.com) and sign in with GitHub.
2. **Add new site** → **Import an existing project** → select your repo.
3. Settings:
   - **Base directory**: `frontend`
   - **Publish directory**: `frontend`
   - **Build command**: *(leave blank)*
4. Click **Deploy site**.
5. Note your Netlify URL: `https://your-app.netlify.app`

---

### Step 5 — Set CORS on Render

Go back to Render → your web service → **Environment** → set:

```
FRONTEND_URL = https://your-app.netlify.app
```

> ⚠️ **No trailing slash!** Then click **Manual Deploy** → **Redeploy**.

---

## Test Cases

| # | Test | Steps | Expected Result |
|---|------|-------|-----------------|
| 1 | **Add Student** | Fill form with ST101 / Rahul Sharma / rahul@example.com / CSE / 5 → click Add | "Student added successfully." Banner; row appears in table |
| 2 | **Display All** | Open page or refresh | All student records load in the table |
| 3 | **Live Search** | Type "rahul" in the search box | Table filters to show only matching names |
| 4 | **Update Student** | Click ✏️ Edit on ST101 → change Semester to 6 → click Update | "Student updated successfully." Semester shows 6 in table |
| 5 | **Delete Student** | Click 🗑️ Delete on ST101 → confirm | Student disappears from table |
| 6 | **DB Verification** | Atlas → Browse Collections → students | Confirm record added/updated/deleted matches UI |
| 7 | **Duplicate ID** | Try adding ST101 again | "Student ID 'ST101' already exists" error shown |
| 8 | **CORS Block** | Run `fetch()` from browser console on a non-allowed origin | Network error / 403-equivalent |

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Server is waking up…" shown | Render free tier cold start (~30 s) | Wait 30 seconds and click Retry |
| `MongoServerError: bad auth` | Wrong Atlas password in connection string | Re-check password in Atlas → Database Access |
| `MongoNetworkError` | Atlas IP not whitelisted | Atlas → Network Access → add `0.0.0.0/0` |
| CORS error in browser console | `FRONTEND_URL` on Render doesn't match Netlify URL | Remove trailing slash; redeploy Render |
| 404 on all API calls | Trailing slash mismatch in `API` constant | Ensure `API` ends with `/api/students` not `/api/students/` |
| Blank page on Netlify | Base/Publish directory wrong | Both should be set to `frontend` |

---

## Project Structure

```
student-system/
├── backend/
│   ├── server.js          # Express server, routes, Mongoose schema
│   ├── package.json       # Dependencies and npm start script
│   ├── .env.example       # Environment variable template
│   └── .gitignore         # Ignores node_modules and .env
├── frontend/
│   ├── index.html         # Single-page UI structure
│   ├── style.css          # Responsive styling
│   ├── script.js          # fetch() calls, CRUD, DOM manipulation
│   └── netlify.toml       # Netlify deployment config
├── README.md
├── DEMO.md                # Faculty demo script
└── .gitignore
```

---

## License

MIT — Free for educational use.
