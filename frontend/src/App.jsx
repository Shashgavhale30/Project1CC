import React from "react";
import AICommandBar from "./AICommandBar";

export default function App() {
  return (
    <div className="app">
      <header className="app-head">
        <h1>ContactFlow</h1>
      </header>
      <main className="app-main">
        <AICommandBar />
      </main>
    </div>
  );
}
