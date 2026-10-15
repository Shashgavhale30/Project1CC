# ContactFlow — Contact Management System

A three-tier cloud web application for managing contact information for clients, colleagues, business partners and vendors.

**Stack:** React 18 (CDN, no build step) + Node.js/Express + MongoDB Atlas
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
cd Project1CC/student-system/backend
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
| `MONGODB_URI` | Atlas connection string — `mongodb+srv://user:pass@cluster.mongodb.net/contactflow` |
| `FRONTEND_URL` | Allowed origin(s), comma-separated, no trailing slash |
| `PORT` | Server port (Render sets this automatically) |

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Health check |
| GET | `/api/contacts` | List contacts (supports `?search=` by name/email/company and `?category=`) |
| GET | `/api/contacts/stats` | Dashboard summary (total contacts, companies, clients, recently added) |
| GET | `/api/contacts/:id` | Get one contact by contactId |
| POST | `/api/contacts` | Create a contact (contactId auto-generated if omitted) |
| PUT | `/api/contacts/:id` | Update a contact (partial update supported) |
| DELETE | `/api/contacts/:id` | Delete a contact |

**Contact fields:** `contactId` (auto), `name`*, `email`*, `phone`, `company`*, `jobTitle`, `category`* (Client, Colleague, Business Partner, Vendor, Other), `notes` (* = required).

> **Note on existing data:** the previous student collection is left untouched in the database. Student records are not compatible with the contact schema, so they were not migrated destructively. You can keep the old collection as an archive and add contacts fresh, or migrate manually once you approve it.

---

## Backend structure

```
backend/
├── server.js                    # Express app, CORS, Mongo connection
├── routes/contacts.js           # HTTP route handlers
├── services/contactService.js   # Data operations & validation (reusable, e.g. for MCP)
└── models/Contact.js            # Mongoose schema
```

---

## Deployment

1. **MongoDB Atlas** — create a free M0 cluster, add a DB user, allow all IPs (`0.0.0.0/0`), copy connection string.

2. **Render** — new Web Service from this repo:
   - Root directory: `backend`
   - Build: `npm install` · Start: `npm start`
   - Env vars: `MONGODB_URI` and `FRONTEND_URL`
   - `FRONTEND_URL` should be your Netlify origin, for example `https://project1cc.netlify.app`

3. **Update** `const API` in `frontend/script.js` to your Render URL + `/api/contacts`, commit and push.

4. **Netlify** — import repo, base dir `frontend`, publish dir `frontend`, no build command.

5. **Update** `FRONTEND_URL` on Render to your Netlify URL (no trailing slash), then redeploy the backend.
