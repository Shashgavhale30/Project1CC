// Change this to your Render URL after deploying the backend
const API = "http://localhost:5000/api/students";

const { useState, useEffect, useRef, useCallback } = React;

const EMPTY = { studentId: "", name: "", email: "", department: "", semester: "", contact: "" };

function Banner({ type, message }) {
  if (!type) return null;
  return <div className={`status-banner ${type}`}>{message}</div>;
}

function StudentForm({ editing, onSave, onCancel, banner, setBanner }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing
      ? { ...editing, semester: String(editing.semester), contact: editing.contact || "" }
      : EMPTY
    );
  }, [editing]);

  function change(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function validate() {
    if (!editing && !form.studentId.trim()) return "Student ID is required.";
    if (!form.name.trim()) return "Name is required.";
    if (!/\S+@\S+\.\S+/.test(form.email)) return "Valid email is required.";
    if (!form.department.trim()) return "Department is required.";
    const s = parseInt(form.semester, 10);
    if (isNaN(s) || s < 1 || s > 12) return "Semester must be between 1 and 12.";
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { setBanner({ type: "error", message: err }); return; }

    setBusy(true);
    const payload = {
      studentId: form.studentId.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      department: form.department.trim(),
      semester: parseInt(form.semester, 10),
      contact: form.contact.trim(),
    };

    try {
      const url = editing ? `${API}/${encodeURIComponent(editing.studentId)}` : API;
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setBanner({ type: "error", message: data.error }); return; }
      setBanner({ type: "success", message: editing ? "Student updated successfully." : "Student added successfully." });
      setForm(EMPTY);
      onSave();
    } catch (err) {
      setBanner({ type: "error", message: "Network error: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" id="form-section">
      <h2>{editing ? `Edit Student — ${editing.studentId}` : "Add New Student"}</h2>
      <Banner type={banner.type} message={banner.message} />
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label>Student ID <span className="req">*</span></label>
            <input name="studentId" value={form.studentId} onChange={change} placeholder="e.g. ST101" disabled={!!editing} required />
          </div>
          <div className="field">
            <label>Full Name <span className="req">*</span></label>
            <input name="name" value={form.name} onChange={change} placeholder="e.g. Rahul Sharma" required />
          </div>
          <div className="field">
            <label>Email <span className="req">*</span></label>
            <input type="email" name="email" value={form.email} onChange={change} placeholder="rahul@example.com" required />
          </div>
          <div className="field">
            <label>Department <span className="req">*</span></label>
            <input name="department" value={form.department} onChange={change} placeholder="e.g. CSE" required />
          </div>
          <div className="field">
            <label>Semester <span className="req">*</span> (1–12)</label>
            <input type="number" name="semester" value={form.semester} onChange={change} min="1" max="12" placeholder="5" required />
          </div>
          <div className="field">
            <label>Contact <span className="opt">(optional)</span></label>
            <input name="contact" value={form.contact} onChange={change} placeholder="+91 9876543210" />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving..." : editing ? "Update Student" : "Add Student"}
          </button>
          {editing && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          )}
        </div>
      </form>
    </section>
  );
}

function StudentRow({ s, onEdit, onDelete }) {
  return (
    <tr>
      <td>{s.studentId}</td>
      <td>{s.name}</td>
      <td>{s.email}</td>
      <td>{s.department}</td>
      <td>{s.semester}</td>
      <td>{s.contact || "—"}</td>
      <td>
        <div className="actions-cell">
          <button className="btn btn-edit" onClick={() => onEdit(s)}>Edit</button>
          <button className="btn btn-delete" onClick={() => onDelete(s.studentId, s.name)}>Delete</button>
        </div>
      </td>
    </tr>
  );
}

function App() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [coldStart, setColdStart] = useState(false);
  const [editing, setEditing] = useState(null);
  const [banner, setBanner] = useState({ type: "", message: "" });
  const debounce = useRef(null);

  useEffect(() => {
    if (!banner.message) return;
    const t = setTimeout(() => setBanner({ type: "", message: "" }), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  const load = useCallback(async (search = "") => {
    setLoading(true);
    setColdStart(false);
    const url = search ? `${API}?search=${encodeURIComponent(search)}` : API;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStudents(data);
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "TypeError") setColdStart(true);
      else setBanner({ type: "error", message: "Failed to load: " + err.message });
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e) {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(e.target.value.trim()), 350);
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}" (${id})?`)) return;
    try {
      const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setBanner({ type: "error", message: data.error }); return; }
      setBanner({ type: "success", message: `"${name}" deleted.` });
      if (editing?.studentId === id) setEditing(null);
      load();
    } catch (err) {
      setBanner({ type: "error", message: "Network error: " + err.message });
    }
  }

  return (
    <>
      <header>
        <div className="header-inner">
          <span className="logo">🎓</span>
          <div>
            <h1>Student Information Management System</h1>
            <p className="subtitle">Cloud Computing Mini Project · Netlify + Render + MongoDB Atlas</p>
          </div>
        </div>
      </header>

      <main>
        <StudentForm
          editing={editing}
          onSave={() => { setEditing(null); load(); }}
          onCancel={() => { setEditing(null); setBanner({ type: "", message: "" }); }}
          banner={banner}
          setBanner={setBanner}
        />

        <section className="card">
          <div className="list-header">
            <h2>All Students</h2>
            <div className="search-box">
              <input type="search" placeholder="Search by name..." onChange={handleSearch} aria-label="Search" />
            </div>
          </div>

          {loading && (
            <div className="loading">
              <div className="spinner" />
              <p>Loading...</p>
            </div>
          )}

          {coldStart && (
            <div className="cold-start">
              Server is waking up (Render free tier). Please wait ~30 seconds and{" "}
              <button className="btn-link" onClick={() => load()}>retry</button>.
            </div>
          )}

          {!loading && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Student ID</th><th>Name</th><th>Email</th>
                    <th>Department</th><th>Semester</th><th>Contact</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map(s => (
                    <StudentRow
                      key={s.studentId}
                      s={s}
                      onEdit={student => {
                        setEditing(student);
                        document.getElementById("form-section")?.scrollIntoView({ behavior: "smooth" });
                      }}
                      onDelete={handleDelete}
                    />
                  ))}
                </tbody>
              </table>
              {students.length === 0 && !coldStart && <p className="empty-msg">No students found.</p>}
            </div>
          )}
        </section>
      </main>

      <footer>
        <p>Student Information Management System &mdash; Cloud Computing Project</p>
      </footer>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
