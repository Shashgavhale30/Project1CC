// Change this to your Render URL after deploying the backend
const API = "http://localhost:5000/api/students";

const { useState, useEffect, useRef, useCallback, createElement: h } = React;

const EMPTY = { studentId: "", name: "", email: "", department: "", semester: "", contact: "" };

// ── Banner ────────────────────────────────────────────────
function Banner({ type, message }) {
  if (!type || !message) return null;
  return h("div", { className: "status-banner " + type }, message);
}

// ── Student Form (Add / Edit) ─────────────────────────────
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

  const field = (label, name, type = "text", extra = {}) =>
    h("div", { className: "field" },
      h("label", null, label),
      h("input", { name, type, value: form[name], onChange: change, ...extra })
    );

  return h("section", { className: "card", id: "form-section" },
    h("h2", null, editing ? `Edit Student — ${editing.studentId}` : "Add New Student"),
    h(Banner, { type: banner.type, message: banner.message }),
    h("form", { onSubmit: submit, noValidate: true },
      h("div", { className: "form-grid" },
        field(h("span", null, "Student ID ", h("span", { className: "req" }, "*")), "studentId", "text",
          { placeholder: "e.g. ST101", disabled: !!editing, required: true }),
        field(h("span", null, "Full Name ", h("span", { className: "req" }, "*")), "name", "text",
          { placeholder: "e.g. Rahul Sharma", required: true }),
        field(h("span", null, "Email ", h("span", { className: "req" }, "*")), "email", "email",
          { placeholder: "rahul@example.com", required: true }),
        field(h("span", null, "Department ", h("span", { className: "req" }, "*")), "department", "text",
          { placeholder: "e.g. CSE", required: true }),
        field(h("span", null, "Semester ", h("span", { className: "req" }, "*"), " (1–12)"), "semester", "number",
          { placeholder: "5", min: "1", max: "12", required: true }),
        field(h("span", null, "Contact ", h("span", { className: "opt" }, "(optional)")), "contact", "text",
          { placeholder: "+91 9876543210" }),
      ),
      h("div", { className: "form-actions" },
        h("button", { type: "submit", className: "btn btn-primary", disabled: busy },
          busy ? "Saving..." : editing ? "Update Student" : "Add Student"
        ),
        editing && h("button", { type: "button", className: "btn btn-secondary", onClick: onCancel }, "Cancel"),
      )
    )
  );
}

// ── Student Row ───────────────────────────────────────────
function StudentRow({ s, onEdit, onDelete }) {
  return h("tr", null,
    h("td", null, s.studentId),
    h("td", null, s.name),
    h("td", null, s.email),
    h("td", null, s.department),
    h("td", null, s.semester),
    h("td", null, s.contact || "—"),
    h("td", null,
      h("div", { className: "actions-cell" },
        h("button", { className: "btn btn-edit", onClick: () => onEdit(s) }, "Edit"),
        h("button", { className: "btn btn-delete", onClick: () => onDelete(s.studentId, s.name) }, "Delete"),
      )
    )
  );
}

// ── App (root) ────────────────────────────────────────────
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

  function startEdit(student) {
    setEditing(student);
    document.getElementById("form-section")?.scrollIntoView({ behavior: "smooth" });
  }

  return h("div", null,
    h("header", null,
      h("div", { className: "header-inner" },
        h("span", { className: "logo" }, "🎓"),
        h("div", null,
          h("h1", null, "Student Information Management System"),
          h("p", { className: "subtitle" }, "Cloud Computing Mini Project · Netlify + Render + MongoDB Atlas"),
        )
      )
    ),

    h("main", null,
      h(StudentForm, {
        editing,
        onSave: () => { setEditing(null); load(); },
        onCancel: () => { setEditing(null); setBanner({ type: "", message: "" }); },
        banner,
        setBanner,
      }),

      h("section", { className: "card" },
        h("div", { className: "list-header" },
          h("h2", null, "All Students"),
          h("div", { className: "search-box" },
            h("input", { type: "search", placeholder: "Search by name...", onChange: handleSearch })
          )
        ),

        loading && h("div", { className: "loading" },
          h("div", { className: "spinner" }),
          h("p", null, "Loading...")
        ),

        coldStart && h("div", { className: "cold-start" },
          "Server is waking up (Render free tier). Please wait ~30 seconds and ",
          h("button", { className: "btn-link", onClick: () => load() }, "retry"), "."
        ),

        !loading && h("div", { className: "table-wrapper" },
          h("table", null,
            h("thead", null,
              h("tr", null,
                ["Student ID","Name","Email","Department","Semester","Contact","Actions"]
                  .map(col => h("th", { key: col }, col))
              )
            ),
            h("tbody", null,
              students.map(s =>
                h(StudentRow, { key: s.studentId, s, onEdit: startEdit, onDelete: handleDelete })
              )
            )
          ),
          students.length === 0 && !coldStart &&
            h("p", { className: "empty-msg" }, "No students found.")
        )
      )
    ),

    h("footer", null,
      h("p", null, "Student Information Management System — Cloud Computing Project")
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App, null));
