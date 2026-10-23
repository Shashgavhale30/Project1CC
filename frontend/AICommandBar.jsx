import React, { useState } from "react";

const API_BASE = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:5000"
  : "https://project1cc-backend.onrender.com";

/**
 * AICommandBar
 *
 * A natural-language command bar that sends a free-text instruction to the
 * backend Gemini-powered /api/ai-command endpoint and reports the result.
 */
export default function AICommandBar() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setLoading(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/ai-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setMessage(data.message || "Command processed successfully.");
      setPrompt("");
    } catch (err) {
      setError(err.message || "Failed to process AI command.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-command-bar">
      <form onSubmit={handleSubmit} className="ai-command-form">
        <input
          type="text"
          className="ai-command-input"
          placeholder="Tell AI what to do (e.g. Add John, john@example.com)…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={loading}
          aria-label="AI command"
        />
        <button
          type="submit"
          className="btn btn-primary ai-command-submit"
          disabled={loading || !prompt.trim()}
        >
          {loading ? "Thinking…" : "Run"}
        </button>
      </form>

      {message && (
        <div className="banner success" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
