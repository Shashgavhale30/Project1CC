/**
 * script.js — Tier 1 (Frontend Logic)
 * Uses fetch() to call the Tier 2 REST API (Render backend).
 * The frontend NEVER connects to MongoDB directly.
 *
 * ── IMPORTANT ──────────────────────────────────────────────
 * Change API below to your Render URL after deploying the backend.
 * e.g. const API = "https://student-system-xxxx.onrender.com/api/students";
 * ────────────────────────────────────────────────────────────
 */
const API = "http://localhost:5000/api/students";

// ── STATE ──────────────────────────────────────────────────
let editingId = null; // studentId currently being edited (null = add mode)
let searchTimeout = null; // debounce timer for live search

// ── DOM REFERENCES ─────────────────────────────────────────
const form        = document.getElementById("student-form");
const formTitle   = document.getElementById("form-title");
const submitBtn   = document.getElementById("submit-btn");
const cancelBtn   = document.getElementById("cancel-btn");
const banner      = document.getElementById("status-banner");
const searchInput = document.getElementById("search-input");
const tableBody   = document.getElementById("table-body");
const loading     = document.getElementById("loading");
const emptyMsg    = document.getElementById("empty-msg");
const coldNotice  = document.getElementById("cold-start-notice");
const retryBtn    = document.getElementById("retry-btn");

// Form fields
const fStudentId  = document.getElementById("studentId");
const fName       = document.getElementById("name");
const fEmail      = document.getElementById("email");
const fDepartment = document.getElementById("department");
const fSemester   = document.getElementById("semester");
const fContact    = document.getElementById("contact");

// ── INIT ───────────────────────────────────────────────────
loadStudents();

// ── EVENT LISTENERS ────────────────────────────────────────

// Form submit: handles both Add and Edit
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (editingId) {
    await updateStudent(editingId);
  } else {
    await addStudent();
  }
});

// Cancel Edit: revert form back to Add mode
cancelBtn.addEventListener("click", () => {
  resetForm();
  hideBanner();
});

// Live search: debounced so we don't hit the API on every keystroke
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    loadStudents(searchInput.value.trim());
  }, 350);
});

// Cold-start retry button
retryBtn.addEventListener("click", () => {
  coldNotice.classList.add("hidden");
  loadStudents(searchInput.value.trim());
});

// ── FUNCTIONS ──────────────────────────────────────────────

/** Fetch all students (or filtered by name) and render the table. */
async function loadStudents(search = "") {
  showLoading(true);
  coldNotice.classList.add("hidden");

  const url = search ? `${API}?search=${encodeURIComponent(search)}` : API;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to load students");
    }

    renderTable(data);
  } catch (err) {
    // Detect cold start: fetch fails (network error) or times out
    if (err.name === "TimeoutError" || err.name === "TypeError" || !navigator.onLine) {
      coldNotice.classList.remove("hidden");
    } else {
      showBanner("error", "Error loading students: " + err.message);
    }
    renderTable([]); // Show empty table so the UI doesn't break
  } finally {
    showLoading(false);
  }
}

/** Render student records into the HTML table using textContent (XSS-safe). */
function renderTable(students) {
  tableBody.innerHTML = ""; // Clear existing rows

  if (students.length === 0) {
    emptyMsg.classList.remove("hidden");
    return;
  }

  emptyMsg.classList.add("hidden");

  students.forEach((s) => {
    const tr = document.createElement("tr");

    // Build each cell safely using textContent — no innerHTML with user data
    const cells = [
      s.studentId,
      s.name,
      s.email,
      s.department,
      String(s.semester),
      s.contact || "—",
    ];

    cells.forEach((val) => {
      const td = document.createElement("td");
      td.textContent = val;
      tr.appendChild(td);
    });

    // Actions cell: Edit and Delete buttons
    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";

    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-edit";
    editBtn.textContent = "✏️ Edit";
    editBtn.addEventListener("click", () => startEdit(s));

    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-delete";
    delBtn.textContent = "🗑️ Delete";
    delBtn.addEventListener("click", () => deleteStudent(s.studentId, s.name));

    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);

    tableBody.appendChild(tr);
  });
}

/** Collect and validate form data; POST to backend to create a new student. */
async function addStudent() {
  const payload = getFormPayload();
  if (!payload) return; // Client-side validation failed

  submitBtn.disabled = true;
  submitBtn.textContent = "Adding…";

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      // Surface backend validation / duplicate errors to the user
      showBanner("error", data.error || "Failed to add student");
      return;
    }

    showBanner("success", "Student added successfully.");
    resetForm();
    loadStudents();
  } catch (err) {
    showBanner("error", "Network error: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add Student";
  }
}

/** Fill the form with an existing student's data and switch to Edit mode. */
function startEdit(student) {
  editingId = student.studentId;

  fStudentId.value  = student.studentId;
  fName.value       = student.name;
  fEmail.value      = student.email;
  fDepartment.value = student.department;
  fSemester.value   = student.semester;
  fContact.value    = student.contact || "";

  // Lock studentId so the natural key can't be changed during edit
  fStudentId.disabled = true;

  // Update UI to indicate Edit mode
  formTitle.textContent = "✏️ Edit Student: " + student.studentId;
  submitBtn.textContent = "Update Student";
  submitBtn.classList.replace("btn-primary", "btn-primary"); // stays primary
  cancelBtn.classList.remove("hidden");

  hideBanner();

  // Scroll to form on mobile
  document.getElementById("form-section").scrollIntoView({ behavior: "smooth" });
}

/** PUT updated data to the backend for the student currently being edited. */
async function updateStudent(studentId) {
  const payload = getFormPayload(true); // true = skip studentId validation
  if (!payload) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Updating…";

  try {
    const res = await fetch(`${API}/${encodeURIComponent(studentId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showBanner("error", data.error || "Failed to update student");
      return;
    }

    showBanner("success", "Student updated successfully.");
    resetForm();
    loadStudents();
  } catch (err) {
    showBanner("error", "Network error: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Update Student";
  }
}

/** Show a confirm dialog, then DELETE the student from the backend. */
async function deleteStudent(studentId, name) {
  if (!confirm(`Delete student "${name}" (${studentId})? This cannot be undone.`)) return;

  try {
    const res = await fetch(`${API}/${encodeURIComponent(studentId)}`, {
      method: "DELETE",
    });
    const data = await res.json();

    if (!res.ok) {
      showBanner("error", data.error || "Failed to delete student");
      return;
    }

    showBanner("success", `Student "${name}" deleted successfully.`);
    // If we were editing this student, cancel the edit
    if (editingId === studentId) resetForm();
    loadStudents();
  } catch (err) {
    showBanner("error", "Network error: " + err.message);
  }
}

// ── HELPERS ───────────────────────────────────────────────

/**
 * Read and validate all form fields.
 * Returns a plain object ready to POST/PUT, or null if validation fails.
 * @param {boolean} skipStudentId – true when updating (studentId is locked)
 */
function getFormPayload(skipStudentId = false) {
  const studentId  = fStudentId.value.trim();
  const name       = fName.value.trim();
  const email      = fEmail.value.trim();
  const department = fDepartment.value.trim();
  const semester   = parseInt(fSemester.value, 10);
  const contact    = fContact.value.trim();

  if (!skipStudentId && !studentId) { showBanner("error", "Student ID is required."); return null; }
  if (!name)                        { showBanner("error", "Full Name is required.");   return null; }
  if (!email || !/\S+@\S+\.\S+/.test(email)) { showBanner("error", "A valid email is required."); return null; }
  if (!department)                  { showBanner("error", "Department is required.");  return null; }
  if (isNaN(semester) || semester < 1 || semester > 12) {
    showBanner("error", "Semester must be a number between 1 and 12.");
    return null;
  }

  return { studentId, name, email, department, semester, contact };
}

/** Reset the form to its default "Add" state. */
function resetForm() {
  form.reset();
  fStudentId.disabled = false;
  editingId = null;
  formTitle.textContent = "➕ Add New Student";
  submitBtn.textContent = "Add Student";
  cancelBtn.classList.add("hidden");
}

/** Show a status banner with type "success" or "error". Auto-hides after 5 s. */
function showBanner(type, message) {
  banner.className = `status-banner ${type}`;
  banner.textContent = message; // textContent — safe against XSS
  banner.classList.remove("hidden");
  clearTimeout(banner._timer);
  banner._timer = setTimeout(hideBanner, 5000);
}

function hideBanner() {
  banner.classList.add("hidden");
  banner.className = "status-banner hidden";
}

/** Toggle the loading spinner and table visibility. */
function showLoading(show) {
  loading.classList.toggle("hidden", !show);
  tableBody.innerHTML = show ? "" : tableBody.innerHTML;
}
