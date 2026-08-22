/* Together Tasks — static GitHub Pages client + Supabase backend */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(cfg.SUPABASE_URL || "") && !String(cfg.SUPABASE_ANON_KEY || "").startsWith("YOUR_");
  const db = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  const $ = (id) => document.getElementById(id);
  const state = { demo: false, user: null, groups: [], group: null, tasks: [], members: [], authMode: "login", view: "dashboard" };
  const demoKey = "together-tasks-demo-v1";
  const labels = { dashboard: ["WORKSPACE", "Overview"], tasks: ["ALL WORK", "Tasks"], team: ["PEOPLE", "Team"], settings: ["PREFERENCES", "Settings"] };

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  }
  function initials(name = "User") { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase() || "U"; }
  function toast(message, error = false) {
    const el = $("toast"); el.textContent = message; el.className = `toast show${error ? " error" : ""}`;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = "toast"; }, 3000);
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function formatDate(value) { if (!value) return "No due date"; return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function generateCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

  function demoSeed() {
    const user = { id: "demo-user", email: "ahmad@example.com", user_metadata: { full_name: "Ahmad Iqbal" } };
    const group = { id: "demo-group", name: "Launch Team", description: "Website launch and client onboarding", invite_code: "TEAM26", owner_id: user.id };
    const members = [
      { group_id: group.id, user_id: user.id, role: "owner", profiles: { id: user.id, full_name: "Ahmad Iqbal", email: user.email } },
      { group_id: group.id, user_id: "demo-2", role: "member", profiles: { id: "demo-2", full_name: "Sara Khan", email: "sara@example.com" } },
      { group_id: group.id, user_id: "demo-3", role: "member", profiles: { id: "demo-3", full_name: "Usman Ali", email: "usman@example.com" } }
    ];
    const tasks = [
      { id: uid(), group_id: group.id, title: "Finalize mobile homepage", description: "Review the new layout and approve the final copy.", status: "in_progress", priority: "high", due_date: addDays(1), assignee_id: user.id, created_by: user.id },
      { id: uid(), group_id: group.id, title: "Prepare onboarding checklist", description: "Create the steps a new client should complete in week one.", status: "todo", priority: "medium", due_date: addDays(3), assignee_id: "demo-2", created_by: user.id },
      { id: uid(), group_id: group.id, title: "Test contact form", description: "Verify validation and confirmation on mobile.", status: "done", priority: "high", due_date: todayISO(), assignee_id: "demo-3", created_by: user.id },
      { id: uid(), group_id: group.id, title: "Collect launch assets", description: "Logos, product images and final brand files.", status: "todo", priority: "low", due_date: addDays(6), assignee_id: "demo-3", created_by: user.id }
    ];
    return { user, groups: [group], groupId: group.id, members, tasks };
  }
  function saveDemo() { localStorage.setItem(demoKey, JSON.stringify({ user: state.user, groups: state.groups, groupId: state.group?.id, members: state.members, tasks: state.tasks })); }
  function loadDemo() {
    state.demo = true;
    const saved = JSON.parse(localStorage.getItem(demoKey) || "null") || demoSeed();
    state.user = saved.user; state.groups = saved.groups; state.group = saved.groups.find((g) => g.id === saved.groupId) || saved.groups[0] || null; state.members = saved.members; state.tasks = saved.tasks;
    saveDemo(); enterApp();
  }

  async function init() {
    bindEvents();
    if (!configured) { showAuth(); return; }
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) await startSession(session.user); else showAuth();
    db.auth.onAuthStateChange((event, sessionNow) => {
      if (event === "SIGNED_OUT") showAuth();
      else if (sessionNow?.user && !state.user) setTimeout(() => startSession(sessionNow.user), 0);
    });
  }

  function showAuth() { $("app-view").classList.add("hidden"); $("auth-view").classList.remove("hidden"); }
  async function startSession(user) {
    state.demo = false; state.user = user;
    await loadGroups(); enterApp();
  }
  function enterApp() {
    $("auth-view").classList.add("hidden"); $("app-view").classList.remove("hidden");
    const name = state.user?.user_metadata?.full_name || state.user?.email?.split("@")[0] || "User";
    $("user-name").textContent = name; $("user-email").textContent = state.demo ? "Demo preview" : state.user.email;
    $("user-avatar").textContent = initials(name); $("settings-user-name").textContent = name; $("settings-user-email").textContent = state.user.email || "Demo preview";
    renderGroupPicker();
    if (!state.group) { openDialog("group-dialog"); renderAll(); return; }
    if (state.demo) renderAll(); else loadGroupData().catch((e) => toast(e.message, true));
  }

  async function loadGroups() {
    const { data, error } = await db.from("group_members").select("group_id, role, groups(id,name,description,invite_code,owner_id,created_at)").eq("user_id", state.user.id);
    if (error) throw error;
    state.groups = (data || []).map((x) => ({ ...x.groups, my_role: x.role })).filter(Boolean);
    const remembered = localStorage.getItem("together-current-group");
    state.group = state.groups.find((g) => g.id === remembered) || state.groups[0] || null;
  }
  async function loadGroupData() {
    if (!state.group) return renderAll();
    const [tasksRes, membersRes] = await Promise.all([
      db.from("tasks").select("*").eq("group_id", state.group.id).order("created_at", { ascending: false }),
      db.from("group_members").select("group_id,user_id,role,joined_at,profiles(id,full_name,email,avatar_color)").eq("group_id", state.group.id).order("joined_at")
    ]);
    if (tasksRes.error) throw tasksRes.error; if (membersRes.error) throw membersRes.error;
    state.tasks = tasksRes.data || []; state.members = membersRes.data || []; renderAll();
  }

  function renderAll() {
    renderGroupPicker(); renderDashboard(); renderTasks(); renderTeam(); renderSettings(); fillAssignees();
  }
  function renderGroupPicker() {
    const select = $("group-select");
    select.innerHTML = state.groups.length ? state.groups.map((g) => `<option value="${g.id}" ${g.id === state.group?.id ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join("") : '<option value="">No group yet</option>';
  }
  function renderDashboard() {
    const total = state.tasks.length, done = state.tasks.filter((t) => t.status === "done").length, open = total - done;
    const soon = state.tasks.filter((t) => t.status !== "done" && t.due_date && t.due_date >= todayISO() && t.due_date <= addDays(3)).length;
    const percent = total ? Math.round(done / total * 100) : 0;
    $("stat-open").textContent = open; $("stat-due").textContent = soon; $("stat-done").textContent = done; $("progress-percent").textContent = `${percent}%`;
    $("progress-ring").style.background = `conic-gradient(var(--brand) ${percent}%,#dfdef1 ${percent}%)`;
    const name = state.user?.user_metadata?.full_name?.split(" ")[0] || "there";
    $("greeting").textContent = `Hi ${name}, let’s make progress.`; $("welcome-copy").textContent = state.group ? `${state.group.name} has ${open} open task${open === 1 ? "" : "s"}.` : "Create or join a group to begin.";
    const priority = [...state.tasks].filter((t) => t.status !== "done").sort(taskSort).slice(0, 4);
    $("priority-list").innerHTML = priority.length ? priority.map(taskCard).join("") : emptyState("Nothing urgent", "Add a task when your group is ready."); bindTaskCards($("priority-list"));
  }
  function taskSort(a, b) {
    const p = { high: 0, medium: 1, low: 2 };
    return (p[a.priority] - p[b.priority]) || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"));
  }
  function memberName(id) { const m = state.members.find((x) => x.user_id === id); return m?.profiles?.full_name || (id ? "Team member" : "Unassigned"); }
  function taskCard(task) {
    const overdue = task.status !== "done" && task.due_date && task.due_date < todayISO();
    return `<article class="task-card ${task.status === "done" ? "done" : ""}" data-task="${task.id}">
      <button class="check" data-toggle="${task.id}" aria-label="${task.status === "done" ? "Reopen" : "Complete"} task">✓</button>
      <div class="task-main"><h4>${escapeHtml(task.title)}</h4>${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}<div class="task-meta"><span class="priority-${task.priority}">${escapeHtml(task.priority)}</span><span class="${overdue ? "overdue" : ""}">${overdue ? "Overdue · " : ""}${formatDate(task.due_date)}</span><span>${escapeHtml(memberName(task.assignee_id))}</span></div></div>
      <div class="task-menu"><button data-edit="${task.id}" title="Edit">✎</button><button data-delete="${task.id}" title="Delete">×</button></div></article>`;
  }
  function emptyState(title, copy) { return `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(copy)}</div>`; }
  function renderTasks() {
    const q = $("task-search").value.trim().toLowerCase(), status = $("status-filter").value, priority = $("priority-filter").value;
    const rows = [...state.tasks].filter((t) => (!q || `${t.title} ${t.description || ""}`.toLowerCase().includes(q)) && (status === "all" || t.status === status) && (priority === "all" || t.priority === priority)).sort(taskSort);
    $("task-list").innerHTML = rows.length ? rows.map(taskCard).join("") : emptyState("No matching tasks", "Try changing the filters or add a new task."); bindTaskCards($("task-list"));
  }
  function bindTaskCards(root) {
    root.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => toggleTask(b.dataset.toggle));
    root.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => editTask(b.dataset.edit));
    root.querySelectorAll("[data-delete]").forEach((b) => b.onclick = () => deleteTask(b.dataset.delete));
  }
  function renderTeam() {
    $("invite-code").textContent = state.group?.invite_code || "—"; $("member-count").textContent = `${state.members.length} ${state.members.length === 1 ? "person" : "people"}`;
    $("member-list").innerHTML = state.members.length ? state.members.map((m) => { const p = m.profiles || {}; return `<article class="member-card"><div class="avatar">${escapeHtml(initials(p.full_name || p.email))}</div><div><strong>${escapeHtml(p.full_name || "Team member")}</strong><small>${escapeHtml(p.email || "")} · ${escapeHtml(m.role)}</small></div></article>`; }).join("") : emptyState("No members yet", "Share the group code to invite someone.");
  }
  function renderSettings() {
    $("settings-group-name").textContent = state.group?.name || "No group selected"; $("settings-group-description").textContent = state.group?.description || "Create or join a group to manage shared tasks.";
  }
  function fillAssignees() {
    $("task-assignee").innerHTML = '<option value="">Unassigned</option>' + state.members.map((m) => `<option value="${m.user_id}">${escapeHtml(m.profiles?.full_name || m.profiles?.email || "Member")}</option>`).join("");
  }

  async function handleAuth(event) {
    event.preventDefault(); if (!configured) return toast("Add your Supabase URL and publishable key in config.js, or use Demo Preview.", true);
    const email = $("auth-email").value.trim(), password = $("auth-password").value, fullName = $("auth-name").value.trim();
    $("auth-submit").disabled = true;
    try {
      if (state.authMode === "signup") {
        const { data, error } = await db.auth.signUp({ email, password, options: { data: { full_name: fullName } } }); if (error) throw error;
        if (!data.session) toast("Check your email to confirm the account."); else await startSession(data.user);
      } else { const { data, error } = await db.auth.signInWithPassword({ email, password }); if (error) throw error; await startSession(data.user); }
    } catch (e) { toast(e.message, true); } finally { $("auth-submit").disabled = false; }
  }
  function setAuthTab(mode) {
    state.authMode = mode; document.querySelectorAll("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b.dataset.authTab === mode));
    $("name-field").classList.toggle("hidden", mode !== "signup"); $("auth-name").required = mode === "signup"; $("auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
    $("auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  }
  function switchView(view) {
    state.view = view; document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden")); $(`${view}-screen`).classList.remove("hidden");
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view)); $("page-kicker").textContent = labels[view][0]; $("page-title").textContent = labels[view][1]; window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function openDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
  function openTask(task = null) {
    if (!state.group) return openDialog("group-dialog");
    $("task-form").reset(); $("task-id").value = task?.id || ""; $("task-modal-title").textContent = task ? "Edit task" : "Add a task";
    if (task) { $("task-title").value = task.title; $("task-description").value = task.description || ""; $("task-status").value = task.status; $("task-priority").value = task.priority; $("task-due").value = task.due_date || ""; $("task-assignee").value = task.assignee_id || ""; }
    openDialog("task-dialog"); setTimeout(() => $("task-title").focus(), 50);
  }
  function editTask(id) { openTask(state.tasks.find((t) => t.id === id)); }

  async function saveTask(event) {
    event.preventDefault();
    const id = $("task-id").value, old = state.tasks.find((t) => t.id === id);
    const task = { group_id: state.group.id, title: $("task-title").value.trim(), description: $("task-description").value.trim() || null, status: $("task-status").value, priority: $("task-priority").value, due_date: $("task-due").value || null, assignee_id: $("task-assignee").value || null };
    if (!task.title) return;
    try {
      if (state.demo) {
        if (old) Object.assign(old, task); else state.tasks.unshift({ ...task, id: uid(), created_by: state.user.id, created_at: new Date().toISOString() }); saveDemo();
      } else {
        const query = old ? db.from("tasks").update(task).eq("id", id) : db.from("tasks").insert({ ...task, created_by: state.user.id }); const { error } = await query; if (error) throw error; await loadGroupData();
      }
      $("task-dialog").close(); renderAll(); toast(old ? "Task updated" : "Task added");
    } catch (e) { toast(e.message, true); }
  }
  async function toggleTask(id) {
    const task = state.tasks.find((t) => t.id === id), status = task.status === "done" ? "todo" : "done";
    try { if (state.demo) { task.status = status; saveDemo(); } else { const { error } = await db.from("tasks").update({ status }).eq("id", id); if (error) throw error; await loadGroupData(); } renderAll(); } catch (e) { toast(e.message, true); }
  }
  async function deleteTask(id) {
    const task = state.tasks.find((t) => t.id === id); if (!task || !confirm(`Delete “${task.title}”?`)) return;
    try { if (state.demo) { state.tasks = state.tasks.filter((t) => t.id !== id); saveDemo(); } else { const { error } = await db.from("tasks").delete().eq("id", id); if (error) throw error; await loadGroupData(); } renderAll(); toast("Task deleted"); } catch (e) { toast(e.message, true); }
  }

  async function createGroup(event) {
    event.preventDefault(); const name = $("group-name").value.trim(), description = $("group-description").value.trim();
    try {
      let group;
      if (state.demo) { group = { id: uid(), name, description, invite_code: generateCode(), owner_id: state.user.id, my_role: "owner" }; state.groups.push(group); state.members = [{ group_id: group.id, user_id: state.user.id, role: "owner", profiles: { id: state.user.id, full_name: state.user.user_metadata.full_name, email: state.user.email } }]; state.tasks = []; state.group = group; saveDemo(); }
      else { const { data, error } = await db.rpc("create_group", { p_name: name, p_description: description || null }); if (error) throw error; await loadGroups(); group = state.groups.find((g) => g.id === data); state.group = group || state.groups[0]; await loadGroupData(); }
      localStorage.setItem("together-current-group", state.group.id); $("group-dialog").close(); $("create-group-form").reset(); renderAll(); toast("Group created");
    } catch (e) { toast(e.message, true); }
  }
  async function joinGroup(event) {
    event.preventDefault(); const code = $("join-code").value.trim().toUpperCase();
    try {
      if (state.demo) return toast("Demo preview cannot join another person’s group. Connect Supabase to use invite codes.", true);
      const { data, error } = await db.rpc("join_group", { p_invite_code: code }); if (error) throw error; await loadGroups(); state.group = state.groups.find((g) => g.id === data) || state.groups[0]; localStorage.setItem("together-current-group", state.group.id); await loadGroupData(); $("group-dialog").close(); toast("Group joined");
    } catch (e) { toast(e.message, true); }
  }
  function setGroupTab(tab) { document.querySelectorAll("[data-group-tab]").forEach((b) => b.classList.toggle("active", b.dataset.groupTab === tab)); $("create-group-form").classList.toggle("hidden", tab !== "create"); $("join-group-form").classList.toggle("hidden", tab !== "join"); }

  function bindEvents() {
    $("auth-form").addEventListener("submit", handleAuth); $("demo-button").onclick = loadDemo;
    document.querySelectorAll("[data-auth-tab]").forEach((b) => b.onclick = () => setAuthTab(b.dataset.authTab));
    document.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => switchView(b.dataset.view)); document.querySelectorAll("[data-jump]").forEach((b) => b.onclick = () => switchView(b.dataset.jump));
    $("open-task").onclick = () => openTask(); $("open-task-mobile").onclick = () => openTask(); $("open-group").onclick = () => openDialog("group-dialog"); $("settings-group-action").onclick = () => openDialog("group-dialog");
    document.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => $(b.dataset.close).close()); document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
    $("task-form").addEventListener("submit", saveTask); $("create-group-form").addEventListener("submit", createGroup); $("join-group-form").addEventListener("submit", joinGroup);
    document.querySelectorAll("[data-group-tab]").forEach((b) => b.onclick = () => setGroupTab(b.dataset.groupTab));
    [$("task-search"), $("status-filter"), $("priority-filter")].forEach((el) => el.addEventListener(el.tagName === "INPUT" ? "input" : "change", renderTasks));
    $("group-select").onchange = async (e) => { state.group = state.groups.find((g) => g.id === e.target.value) || null; if (state.group) localStorage.setItem("together-current-group", state.group.id); if (state.demo) { const saved = JSON.parse(localStorage.getItem(demoKey)); state.tasks = (saved.tasks || []).filter((t) => t.group_id === state.group.id); state.members = (saved.members || []).filter((m) => m.group_id === state.group.id); renderAll(); } else await loadGroupData(); };
    $("copy-code").onclick = async () => { if (!state.group) return; await navigator.clipboard.writeText(state.group.invite_code); toast("Invite code copied"); };
    $("sign-out").onclick = async () => { if (state.demo) { state.demo = false; state.user = null; } else await db.auth.signOut(); showAuth(); };
  }

  init().catch((e) => { console.error(e); toast(e.message || "The app could not start.", true); showAuth(); });
})();
