// Backend API base URL: Render deployment in production,
// local dev server when the page itself is served from localhost
const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_ROOT = isLocal
  ? "http://localhost:5000/api"
  : "https://project1cc-backend.onrender.com/api";
const API = `${API_ROOT}/contacts`;

const { useState, useEffect, useRef, useCallback, createElement: h } = React;

const CATEGORIES = ["Client", "Colleague", "Business Partner", "Vendor", "Other"];

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  company: "",
  jobTitle: "",
  category: "",
  age: "",
  notes: "",
};

// ---- Small icon set (inline SVG, no dependency) ----
function Icon({ name, size = 18 }) {
  const paths = {
    dashboard: h("path", { d: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" }),
    contacts: h("path", { d: "M16 14a4 4 0 10-8 0M12 10a3 3 0 100-6 3 3 0 000 6M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" }),
    plus: h("path", { d: "M12 5v14M5 12h14" }),
    search: h("path", { d: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" }),
    edit: h("path", { d: "M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" }),
    trash: h("path", { d: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" }),
    building: h("path", { d: "M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16M16 9h3a1 1 0 011 1v11M8 7h4M8 11h4M8 15h4M2 21h20" }),
    users: h("path", { d: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" }),
    clock: h("path", { d: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2" }),
    grid: h("path", { d: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" }),
    menu: h("path", { d: "M3 6h18M3 12h18M3 18h18" }),
    close: h("path", { d: "M18 6L6 18M6 6l12 12" }),
  };
  const filled = name === "dashboard" || name === "grid";
  return h(
    "svg",
    {
      className: "icon",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: filled ? "currentColor" : "none",
      stroke: filled ? "none" : "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
    },
    paths[name]
  );
}

// ---- Banner (success / error feedback) ----
function Banner({ type, message }) {
  if (!type || !message) return null;
  return h("div", { className: `banner ${type}`, role: "alert" }, message);
}

// ---- Stat card ----
function StatCard({ label, value, icon }) {
  return h("div", { className: "stat-card" },
    h("div", { className: "stat-icon" }, h(Icon, { name: icon })),
    h("div", null,
      h("div", { className: "stat-value" }, value),
      h("div", { className: "stat-label" }, label)
    )
  );
}

// ---- Contact form (add / edit) ----
function ContactForm({ editing, onSave, onCancel, banner, setBanner }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(editing
      ? {
          name: editing.name || "",
          email: editing.email || "",
          phone: editing.phone || "",
          company: editing.company || "",
          jobTitle: editing.jobTitle || "",
          category: editing.category || "",
          age: editing.age === null || editing.age === undefined ? "" : String(editing.age),
          notes: editing.notes || "",
        }
      : EMPTY
    );
  }, [editing]);

  function change(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  function validate() {
    if (!form.name.trim()) return "Full name is required.";
    if (!/\S+@\S+\.\S+/.test(form.email)) return "A valid email address is required.";
    if (!form.company.trim()) return "Company / organization is required.";
    if (!CATEGORIES.includes(form.category)) return "Please select a category.";
    if (form.age.trim() !== "") {
      const age = Number(form.age);
      if (!Number.isInteger(age) || age < 0 || age > 120)
        return "Age must be a whole number between 0 and 120.";
    }
    if (form.phone.trim() && form.phone.trim().length > 30) return "Phone number is too long.";
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const err = validate();
    if (err) { setBanner({ type: "error", message: err }); return; }
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      jobTitle: form.jobTitle.trim(),
      category: form.category,
      age: form.age.trim() === "" ? null : Number(form.age),
      notes: form.notes.trim(),
    };
    try {
      const url = editing ? `${API}/${encodeURIComponent(editing.contactId)}` : API;
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setBanner({ type: "error", message: data.error || "Request failed." }); return; }
      setBanner({
        type: "success",
        message: editing ? "Contact updated successfully." : "Contact added successfully.",
      });
      onSave();
    } catch (err) {
      setBanner({ type: "error", message: "Network error: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  const field = (label, name, type = "text", extra = {}, optional = false) =>
    h("div", { className: "field" },
      h("label", { htmlFor: `f-${name}` },
        label,
        optional ? h("span", { className: "opt" }, " · optional") : h("span", { className: "req" }, " *")
      ),
      name === "category"
        ? h("select", { id: `f-${name}`, name, value: form.category, onChange: change, ...extra },
            h("option", { value: "" }, "Select a category…"),
            CATEGORIES.map(c => h("option", { key: c, value: c }, c)))
        : name === "notes"
          ? h("textarea", { id: `f-${name}`, name, value: form.notes, onChange: change, rows: 3, ...extra })
          : h("input", { id: `f-${name}`, name, type, value: form[name], onChange: change, ...extra })
    );

  return h("section", { className: "panel", id: "form-section" },
    h("div", { className: "panel-head" },
      h("div", null,
        h("h2", null, editing ? "Edit Contact" : "Add Contact"),
        h("p", { className: "panel-sub" },
          editing ? `Updating “${editing.name}” (${editing.contactId})` : "Create a new contact record.")),
      h("button", {
        className: "panel-close", "aria-label": "Close form", type: "button",
        onClick: () => { onCancel(); },
      }, h(Icon, { name: "close", size: 16 }))
    ),
    h(Banner, { type: banner.type, message: banner.message }),
    h("form", { onSubmit: submit, noValidate: true },
      h("div", { className: "form-grid" },
        field("Full Name", "name", "text", { placeholder: "e.g. Priya Deshmukh", required: true }),
        field("Email Address", "email", "email", { placeholder: "priya@acme.com", required: true }),
        field("Phone Number", "phone", "tel", { placeholder: "+91 98765 43210" }, true),
        field("Company / Organization", "company", "text", { placeholder: "e.g. Acme Corp", required: true }),
        field("Job Title", "jobTitle", "text", { placeholder: "e.g. Account Manager" }, true),
        field("Category", "category"),
        field("Age", "age", "number", { placeholder: "e.g. 28", min: 0, max: 120, step: 1, inputMode: "numeric" }, true),
        field("Notes", "notes", "text", { placeholder: "Anything worth remembering about this contact…" }, true),
      ),
      h("div", { className: "form-actions" },
        h("button", { type: "submit", className: "btn btn-primary", disabled: busy },
          busy ? "Saving…" : editing ? "Save Changes" : "Add Contact"
        ),
        h("button", { type: "button", className: "btn btn-ghost", onClick: onCancel }, "Cancel"),
      )
    )
  );
}

// ---- Category badge ----
function CategoryBadge({ category }) {
  if (!category) return h("span", null, "—");
  const key = category.toLowerCase().replace(/\s+/g, "-");
  return h("span", { className: `badge badge-${key}` }, category);
}

// ---- Avatar initials ----
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

// ---- Age display (0 is a valid age; null/undefined means not provided) ----
function showAge(age) {
  return age === null || age === undefined ? "—" : age;
}

// ---- Contact row (desktop table) ----
function ContactRow({ c, onEdit, onDelete }) {
  return h("tr", null,
    h("td", null,
      h("div", { className: "person" },
        h("div", { className: "avatar" }, initials(c.name)),
        h("div", null,
          h("div", { className: "person-name" }, c.name),
          h("div", { className: "person-sub" }, c.contactId)
        )
      )
    ),
    h("td", null, h("a", { className: "email-link", href: `mailto:${c.email}` }, c.email)),
    h("td", null, c.company),
    h("td", null, c.jobTitle || "—"),
    h("td", null, h(CategoryBadge, { category: c.category })),
    h("td", null, c.phone || "—"),
    h("td", null, showAge(c.age)),
    h("td", null,
      h("div", { className: "actions-cell" },
        h("button", { className: "icon-btn", "aria-label": `Edit ${c.name}`, title: "Edit",
          onClick: () => onEdit(c) }, h(Icon, { name: "edit", size: 15 })),
        h("button", { className: "icon-btn danger", "aria-label": `Delete ${c.name}`, title: "Delete",
          onClick: () => onDelete(c) }, h(Icon, { name: "trash", size: 15 })),
      )
    )
  );
}

// ---- Contact card (mobile) ----
function ContactCard({ c, onEdit, onDelete }) {
  return h("div", { className: "contact-card" },
    h("div", { className: "contact-card-top" },
      h("div", { className: "avatar" }, initials(c.name)),
      h("div", { className: "contact-card-id" },
        h("div", { className: "person-name" }, c.name),
        h("div", { className: "person-sub" }, c.company)
      ),
      h(CategoryBadge, { category: c.category })
    ),
    h("dl", { className: "contact-card-fields" },
      h("div", null, h("dt", null, "Email"), h("dd", null, c.email)),
      h("div", null, h("dt", null, "Phone"), h("dd", null, c.phone || "—")),
      h("div", null, h("dt", null, "Job Title"), h("dd", null, c.jobTitle || "—")),
      h("div", null, h("dt", null, "Age"), h("dd", null, showAge(c.age))),
    ),
    h("div", { className: "contact-card-actions" },
      h("button", { className: "btn btn-sm btn-secondary", onClick: () => onEdit(c) }, "Edit"),
      h("button", { className: "btn btn-sm btn-danger", onClick: () => onDelete(c) }, "Delete"),
    )
  );
}

// ---- Delete confirmation dialog ----
function ConfirmDelete({ contact, busy, onConfirm, onCancel }) {
  return h("div", { className: "overlay", onClick: (e) => { if (e.target === e.currentTarget) onCancel(); } },
    h("div", { className: "modal", role: "dialog", "aria-modal": "true" },
      h("h3", null, "Delete contact"),
      h("p", null,
        "Are you sure you want to delete ",
        h("strong", null, contact.name),
        ` (${contact.contactId})? This action cannot be undone.`),
      h("div", { className: "modal-actions" },
        h("button", { className: "btn btn-ghost", onClick: onCancel, disabled: busy }, "Cancel"),
        h("button", { className: "btn btn-danger", onClick: onConfirm, disabled: busy },
          busy ? "Deleting…" : "Delete Contact"),
      )
    )
  );
}

// ---- App (root) ----
function App() {
  const [contacts, setContacts] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coldStart, setColdStart] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [banner, setBanner] = useState({ type: "", message: "" });
  const [activeNav, setActiveNav] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    if (!banner.message) return;
    const t = setTimeout(() => setBanner({ type: "", message: "" }), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/stats`, { signal: AbortSignal.timeout(12000) });
      if (res.ok) setStats(await res.json());
    } catch { /* stats are non-critical; leave as null */ }
  }, []);

  const load = useCallback(async (searchVal = "", categoryVal = "") => {
    setLoading(true);
    setColdStart(false);
    const params = new URLSearchParams();
    if (searchVal) params.set("search", searchVal);
    if (categoryVal) params.set("category", categoryVal);
    const qs = params.toString();
    const url = qs ? `${API}?${qs}` : API;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setContacts(data);
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "TypeError") setColdStart(true);
      else setBanner({ type: "error", message: "Failed to load contacts: " + err.message });
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadStats(); }, [load, loadStats]);

  function handleSearch(e) {
    const val = e.target.value.trim();
    setSearch(val);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(val, category), 350);
  }

  function handleCategory(e) {
    const val = e.target.value;
    setCategory(val);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(search, val), 200);
  }

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
    setBanner({ type: "", message: "" });
    setTimeout(() => document.getElementById("form-section")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function startEdit(contact) {
    setEditing(contact);
    setFormOpen(true);
    setBanner({ type: "", message: "" });
    document.getElementById("form-section")?.scrollIntoView({ behavior: "smooth" });
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setBanner({ type: "", message: "" });
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`${API}/${encodeURIComponent(deleting.contactId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setBanner({ type: "error", message: data.error || "Delete failed." }); return; }
      setBanner({ type: "success", message: `“${deleting.name}” deleted.` });
      setDeleting(null);
      if (editing?.contactId === deleting.contactId) closeForm();
      load(search, category);
      loadStats();
    } catch (err) {
      setBanner({ type: "error", message: "Network error: " + err.message });
    } finally {
      setDeleteBusy(false);
    }
  }

  function refreshAll() {
    closeForm();
    load(search, category);
    loadStats();
  }

  const hasActiveForm = formOpen || !!editing;
  const filtering = search || category;
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "contacts", label: "Contacts", icon: "contacts" },
  ];

  const NAV_TARGETS = {
    dashboard: "stats-section",
    contacts: "contacts-section",
  };

  function gotoNav(id) {
    setActiveNav(id);
    setNavOpen(false);
    document.getElementById(NAV_TARGETS[id])?.scrollIntoView({ behavior: "smooth" });
  }

  return h("div", { className: "app" },

    // Sidebar navigation (desktop) / drawer (mobile)
    h("aside", { className: "sidebar" + (navOpen ? " open" : "") },
      h("div", { className: "brand" },
        h("div", { className: "brand-mark" }, "CF"),
        h("span", { className: "brand-name" }, "ContactFlow")
      ),
      h("nav", { className: "nav" },
        navItems.map(item =>
          h("button", {
            key: item.id,
            className: "nav-item" + (activeNav === item.id ? " active" : ""),
            onClick: () => gotoNav(item.id),
          },
            h(Icon, { name: item.icon, size: 18 }),
            item.label)
        )
      ),
      h("div", { className: "sidebar-foot" }, "v2.0")
    ),
    navOpen && h("div", { className: "nav-backdrop", onClick: () => setNavOpen(false) }),

    h("div", { className: "content" },
      h("header", { className: "topbar" },
        h("button", { className: "menu-btn", "aria-label": "Toggle navigation",
          onClick: () => setNavOpen(o => !o) }, h(Icon, { name: "menu", size: 20 })),
        h("div", { className: "brand brand-mobile" },
          h("div", { className: "brand-mark" }, "CF"),
          h("span", { className: "brand-name" }, "ContactFlow")
        ),
        h("div", { className: "topbar-actions" },
          h("button", { className: "btn btn-secondary btn-sm", onClick: openAdd }, "Add Contact"),
        )
      ),

      h("main", { className: "main" },
        h(Banner, { type: banner.type, message: banner.message }),

        // ---- Page header ----
        h("div", { className: "page-head" },
          h("div", null,
            h("h1", null, "Contact Management"),
            h("p", { className: "page-sub" },
              "Keep track of clients, colleagues and business contacts in one place.")
          ),
          h("div", { className: "page-head-actions" },
            h("div", { className: "search-box" },
              h(Icon, { name: "search", size: 16 }),
              h("input", {
                type: "search", placeholder: "Search by name, email or company…",
                value: search, onChange: handleSearch, "aria-label": "Search contacts",
              })
            ),
            h("button", { className: "btn btn-primary", onClick: openAdd },
              h(Icon, { name: "plus", size: 16 }), "Add Contact")
          )
        ),

        // ---- Summary statistics ----
        h("section", { className: "stats-grid", id: "stats-section", "aria-label": "Summary statistics" },
          h(StatCard, { label: "Total Contacts", value: stats ? stats.totalContacts : "—", icon: "contacts" }),
          h(StatCard, { label: "Companies", value: stats ? stats.companies : "—", icon: "building" }),
          h(StatCard, { label: "Clients", value: stats ? stats.clients : "—", icon: "users" }),
          h(StatCard, { label: "Added Last 7 Days", value: stats ? stats.recentlyAdded : "—", icon: "clock" }),
        ),

        // ---- Contact form (add/edit) ----
        hasActiveForm && h(ContactForm, {
          editing,
          onSave: refreshAll,
          onCancel: closeForm,
          banner,
          setBanner,
        }),

        // ---- Contacts list ----
        h("section", { className: "panel", id: "contacts-section" },
          h("div", { className: "panel-head list-head" },
            h("div", null,
              h("h2", null, "All Contacts"),
              h("p", { className: "panel-sub" },
                contacts.length
                  ? `${contacts.length} contact${contacts.length === 1 ? "" : "s"}${filtering ? " (filtered)" : ""}`
                  : "No contacts to show yet.")
            ),
            h("div", { className: "list-filters" },
              h("select", { value: category, onChange: handleCategory, "aria-label": "Filter by category" },
                h("option", { value: "" }, "All categories"),
                CATEGORIES.map(c => h("option", { key: c, value: c }, c))),
            )
          ),

          loading && h("div", { className: "state-block" },
            h("div", { className: "spinner" }), h("p", null, "Loading contacts…")),

          coldStart && !loading && h("div", { className: "state-block" },
            h("p", null, "The server is waking up (Render free tier). Please wait ~30 seconds and "),
            h("button", { className: "btn-link", onClick: () => { load(search, category); loadStats(); } }, "try again"),
            h("p", null, ".")),

          !loading && !coldStart && contacts.length === 0 && h("div", { className: "state-block empty" },
            h(Icon, { name: "contacts", size: 36 }),
            h("h3", null, filtering ? "No matching contacts" : "No contacts yet"),
            h("p", null, filtering
              ? "Try a different search term or category."
              : "Add your first contact to get started."),
            !filtering && h("button", { className: "btn btn-primary", onClick: openAdd },
              h(Icon, { name: "plus", size: 16 }), "Add Contact")),

          !loading && !coldStart && contacts.length > 0 && h("div", null,
            h("div", { className: "table-wrapper" },
              h("table", null,
                h("thead", null,
                  h("tr", null,
                    ["Name", "Email", "Company", "Job Title", "Category", "Phone", "Age", "Actions"]
                      .map(col => h("th", { key: col }, col))
                  )
                ),
                h("tbody", null,
                  contacts.map(c =>
                    h(ContactRow, { key: c.contactId, c, onEdit: startEdit, onDelete: setDeleting }))
                )
              )
            ),
            h("div", { className: "card-list" },
              contacts.map(c =>
                h(ContactCard, { key: c.contactId, c, onEdit: startEdit, onDelete: setDeleting }))
            )
          )
        ),

        h("footer", { className: "app-foot" },
          h("p", null, "ContactFlow — Contact Management System"))
      )
    ),

    deleting && h(ConfirmDelete, {
      contact: deleting, busy: deleteBusy,
      onConfirm: confirmDelete, onCancel: () => { if (!deleteBusy) setDeleting(null); },
    })
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(App, null));
