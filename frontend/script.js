/**
 * script.js — Tier 1 Frontend (React via CDN, no build step)
 * JSX is compiled in the browser by Babel Standalone.
 *
 * ── IMPORTANT ──────────────────────────────────────────────
 * Change API below to your Render URL after deploying the backend.
 * e.g. const API = "https://student-system-xxxx.onrender.com/api/students";
 * ────────────────────────────────────────────────────────────
 */
const API = "http://localhost:5000/api/students";

// Destructure React hooks from the global React object (CDN build)
const { useState, useEffect, useRef, useCallback } = React;

// ─── UTILITY ─────────────────────────────────────────────────────────────────

/** Email format validator (mirrors backend regex) */
const isValidEmail = (v) => /\S+@\S+\.\S+/.test(v);

/** Empty form state — used when resetting or initialising */
const EMPTY_FORM = {
  studentId: "", name: "", email: "",
  department: "", semester: "", contact: "",
};

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

/**
 * StatusBanner — shows success / error messages for 5 seconds then hides.
 * Props: { type: "success"|"error"|"", message: string }
 */
function StatusBanner({ type, message }) {
  if (!type || !message) return null;
  return (
    <div className={`status-banner ${type}`} role="alert">
      {message}
    </div>
  );
}

/**
 * StudentForm — controlled form for Add and Edit.
 * Props: { onSave, editingStudent, onCancelEdit }
 */
function StudentForm({ onSave, editingStudent, onCancelEdit, banner, setBanner }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const isEditing = Boolean(editingStudent);

  // Populate form when an edit is triggered from the table
  useEffect(() => {
    if (editingStudent) {
      setForm({
        studentId:  editingStudent.studentId,
        name:       editingStudent.name,
        email:      editingStudent.email,
        department: editingStudent.department,
        semester:   String(editingStudent.semester),
        contact:    editingStudent.contact || "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [editingStudent]);

  /** Generic change handler for all inputs */
  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  /** Client-side validation before hitting the API */
  function validate() {
    if (!isEditing && !form.studentId.trim()) return "Student ID is required.";
    if (!form.name.trim())                    return "Full Name is required.";
    if (!isValidEmail(form.email))            return "A valid email is required.";
    if (!form.department.trim())              return "Department is required.";
    const sem = parseInt(form.semester, 10);
    if (isNaN(sem) || sem < 1 || sem > 12)   return "Semester must be a number between 1 and 12.";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const error = validate();
    if (error) { setBanner({ type: "error", message: error }); return; }

    setLoading(true);
    const payload = {
      studentId:  form.studentId.trim(),
      name:       form.name.trim(),
      email:      form.email.trim(),
      department: form.department.trim(),
      semester:   parseInt(form.semester, 10),
      contact:    form.contact.trim(),
    };

    try {
      const url    = isEditing ? `${API}/${encodeURIComponent(editingStudent.studentId)}` : API;
      const method = isEditing ? "PUT" : "POST";

      const res  = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setBanner({ type: "error", message: data.error || "Request failed." });
        return;
      }

      setBanner({
        type: "success",
        message: isEditing ? "Student updated successfully." : "Student added successfully.",
      });
      setForm(EMPTY_FORM);
      onSave(); // tell parent to reload the list
    } catch (err) {
      setBanner({ type: "error", message: "Network error: " + err.message });
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setForm(EMPTY_FORM);
    onCancelEdit();
    setBanner({ type: "", message: "" });
  }

  return (
    <section className="card" id="form-section">
      <h2>{isEditing ? `✏️ Edit Student: ${editingStudent.studentId}` : "➕ Add New Student"}</h2>

      <StatusBanner type={banner.type} message={banner.message} />

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label>Student ID <span className="req">*</span></label>
            <input
              name="studentId"
              value={form.studentId}
              onChange={handleChange}
              placeholder="e.g. ST101"
              disabled={isEditing}   /* Lock ID during edit */
              required
            />
          </div>

          <div className="field">
            <label>Full Name <span className="req">*</span></label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Rahul Sharma"
              required
            />
          </div>

          <div className="field">
            <label>Email <span className="req">*</span></label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="rahul@example.com"
              required
            />
          </div>

          <div className="field">
            <label>Department <span className="req">*</span></label>
            <input
              name="department"
              value={form.department}
              onChange={handleChange}
              placeholder="e.g. CSE"
              required
            />
          </div>

          <div className="field">
            <label>Semester <span className="req">*</span> (1–12)</label>
            <input
              type="number"
              name="semester"
              value={form.semester}
              onChange={handleChange}
              min="1" max="12"
              placeholder="5"
              required
            />
          </div>

          <div className="field">
            <label>Contact <span className="opt">(optional)</span></label>
            <input
              name="contact"
              value={form.contact}
              onChange={handleChange}
              placeholder="+91 9876543210"
            />
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Saving…" : isEditing ? "Update Student" : "Add Student"}
          </button>
          {isEditing && (
            <button type="button" className="btn btn-secondary" onClick={handleCancel}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

/**
 * StudentRow — a single <tr> in the table.
 * Props: { student, onEdit, onDelete }
 */
function StudentRow({ student, onEdit, onDelete }) {
  return (
    <tr>
      <td>{student.studentId}</td>
      <td>{student.name}</td>
      <td>{student.email}</td>
      <td>{student.department}</td>
      <td>{student.semester}</td>
      <td>{student.contact || "—"}</td>
      <td>
        <div className="actions-cell">
          <button className="btn btn-edit" onClick={() => onEdit(student)}>✏️ Edit</button>
          <button className="btn btn-delete" onClick={() => onDelete(student.studentId, student.name)}>🗑️ Delete</button>
        </div>
      </td>
    </tr>
  );
}

/**
 * StudentTable — search bar + table of all students.
 * Props: { students, loading, coldStart, onRetry, onEdit, onDelete, onSearch }
 */
function StudentTable({ students, loading, coldStart, onRetry, onEdit, onDelete, onSearch }) {
  const [search, setSearch] = useState("");
  const debounceRef = useRef(null);

  function handleSearch(e) {
    const val = e.target.value;
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(val.trim()), 350);
  }

  return (
    <section className="card" id="list-section">
      <div className="list-header">
        <h2>📋 Student Records</h2>
        <div className="search-box">
          <input
            type="search"
            value={search}
            onChange={handleSearch}
            placeholder="🔍 Search by name…"
            aria-label="Search students by name"
          />
        </div>
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading students…</p>
        </div>
      )}

      {/* Cold-start notice for Render free tier */}
      {coldStart && (
        <div className="cold-start">
          ⏳ The server is waking up (Render free tier cold start).
          Please wait ~30 seconds, then{" "}
          <button className="btn-link" onClick={onRetry}>Retry</button>.
        </div>
      )}

      {!loading && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Semester</th>
                <th>Contact</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <StudentRow
                  key={s.studentId}
                  student={s}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </tbody>
          </table>
          {students.length === 0 && !coldStart && (
            <p className="empty-msg">No students found.</p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── ROOT APP COMPONENT ───────────────────────────────────────────────────────

function App() {
  const [students, setStudents]         = useState([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [coldStart, setColdStart]       = useState(false);
  const [editingStudent, setEditingStudent] = useState(null); // null = Add mode
  const [banner, setBanner]             = useState({ type: "", message: "" });

  // Auto-hide banner after 5 seconds
  useEffect(() => {
    if (!banner.message) return;
    const t = setTimeout(() => setBanner({ type: "", message: "" }), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  /** Fetch students from the backend, optionally filtered by name */
  const loadStudents = useCallback(async (search = "") => {
    setTableLoading(true);
    setColdStart(false);

    const url = search ? `${API}?search=${encodeURIComponent(search)}` : API;

    try {
      const res  = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load students");
      setStudents(data);
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "TypeError") {
        setColdStart(true);
      } else {
        setBanner({ type: "error", message: "Error loading students: " + err.message });
      }
      setStudents([]);
    } finally {
      setTableLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => { loadStudents(); }, [loadStudents]);

  /** Called after a successful add or update */
  function handleSave() {
    setEditingStudent(null);
    loadStudents();
  }

  /** Cancel edit mode */
  function handleCancelEdit() {
    setEditingStudent(null);
  }

  /** Start editing a student — populate form */
  function handleEdit(student) {
    setEditingStudent(student);
    document.getElementById("form-section")?.scrollIntoView({ behavior: "smooth" });
  }

  /** Delete a student after confirmation */
  async function handleDelete(studentId, name) {
    if (!window.confirm(`Delete student "${name}" (${studentId})? This cannot be undone.`)) return;
    try {
      const res  = await fetch(`${API}/${encodeURIComponent(studentId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setBanner({ type: "error", message: data.error || "Delete failed." }); return; }
      setBanner({ type: "success", message: `Student "${name}" deleted successfully.` });
      if (editingStudent?.studentId === studentId) setEditingStudent(null);
      loadStudents();
    } catch (err) {
      setBanner({ type: "error", message: "Network error: " + err.message });
    }
  }

  return (
    <>
      {/* ── HEADER ── */}
      <header>
        <div className="header-inner">
          <span className="logo">🎓</span>
          <div>
            <h1>Student Information Management System</h1>
            <p className="subtitle">Three-Tier Cloud Application · Netlify → Render → MongoDB Atlas</p>
          </div>
        </div>
      </header>

      <main>
        {/* ── FORM (Add / Edit) ── */}
        <StudentForm
          onSave={handleSave}
          editingStudent={editingStudent}
          onCancelEdit={handleCancelEdit}
          banner={banner}
          setBanner={setBanner}
        />

        {/* ── TABLE ── */}
        <StudentTable
          students={students}
          loading={tableLoading}
          coldStart={coldStart}
          onRetry={() => loadStudents()}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onSearch={loadStudents}
        />
      </main>

      <footer>
        <p>Student Information Management System · Cloud Computing Mini Project · Built with React (CDN)</p>
      </footer>
    </>
  );
}

// ─── MOUNT ────────────────────────────────────────────────────────────────────
// React 18 createRoot API
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
