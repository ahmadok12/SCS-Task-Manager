(() => {
  'use strict';

  const cfg = window.SCS_CONFIG || {};
  const db = window.supabase?.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const state = {
    user: null, profile: null, profiles: [], inquiries: [], tasks: [], notifications: [],
    activeInquiry: null, authMode: 'signin', deferredInstall: null,
    realtimeChannel: null, fieldEdit: null, productEdit: null, taskEdit: null, currentView: 'inquiries', pushEnabled: false, inquiryEditMode: false,
    attachmentPreviewUrls: new Map(), attachmentPreviewRequest: 0, openPreviewFileId: null, localProductPhotoUrl: null, inquiryProductPhotoUrl: null, activeLocalPhotoUrl: null
  };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const el = id => document.getElementById(id);
  const statusLabels = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost', on_hold: 'On hold' };
  const fileKindLabels = { client_photo: 'Client photos', shared_photo: 'Photos shared to client', quote: 'Quote', payment_proof: 'Payment proof', other: 'Other file' };
  const fieldMeta = {
    person_name: { label: 'Person name', required: true }, company_name: { label: 'Company name' }, mobile: { label: 'Mobile', type: 'tel' },
    email: { label: 'Email', type: 'email' }, customer_address: { label: 'Customer address', type: 'textarea' }, delivery_address: { label: 'Delivery address', type: 'textarea' },
    status: { label: 'Status', type: 'select', options: statusLabels }, priority: { label: 'Priority', type: 'select', options: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' } },
    source: { label: 'Inquiry source' }, assigned_to: { label: 'Assigned to', type: 'profile' }, quote_amount: { label: 'Quote amount', type: 'number' },
    quote_currency: { label: 'Quote currency', type: 'select', options: { USD: 'USD', PKR: 'PKR', AED: 'AED', SAR: 'SAR', CNY: 'CNY' } },
    quote_notes: { label: 'Quote notes', type: 'textarea' }, payment_notes: { label: 'Payment notes', type: 'textarea' }
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    window.lucide?.createIcons();
    bindEvents();
    registerPwa();
    if (!db) return showAuthError('App configuration could not be loaded.');
    const { data: { session } } = await db.auth.getSession();
    if (session) await enterApp(session.user);
    db.auth.onAuthStateChange((event, sessionNow) => {
      if (event === 'SIGNED_OUT') showAuth();
      if (event === 'SIGNED_IN' && sessionNow?.user && sessionNow.user.id !== state.user?.id) enterApp(sessionNow.user);
    });
  }

  function bindEvents() {
    el('authForm').addEventListener('submit', handleAuth);
    el('authModeToggle').addEventListener('click', toggleAuthMode);
    el('addInquiryBtn').addEventListener('click', openInquiryForm);
    el('mobileAddBtn').addEventListener('click', () => state.currentView === 'tasks' ? openTaskForm() : openInquiryForm());
    document.addEventListener('click', handleDelegatedClick);
    el('searchInput').addEventListener('input', renderInquiries);
    el('statusFilter').addEventListener('change', renderInquiries);
    el('sortSelect').addEventListener('change', renderInquiries);
    el('notificationBtn').addEventListener('click', () => openPanel('notificationPanel'));
    el('profileBtn').addEventListener('click', () => openPanel('profilePanel'));
    el('scrim').addEventListener('click', closePanels);
    el('signOutBtn').addEventListener('click', () => db.auth.signOut());
    el('inquiryForm').addEventListener('submit', saveNewInquiry);
    el('fieldEditForm').addEventListener('submit', saveFieldEdit);
    el('productForm').addEventListener('submit', saveProduct);
    el('taskForm').addEventListener('submit', saveTask);
    el('taskSearchInput').addEventListener('input', renderTasks);
    el('taskOwnerFilter').addEventListener('change', renderTasks);
    el('taskStatusFilter').addEventListener('change', renderTasks);
    el('markAllReadBtn').addEventListener('click', markAllRead);
    el('enableAlertsBtn').addEventListener('click', enableBrowserAlerts);
    el('installBtn').addEventListener('click', installPwa);
    el('inquiryDetailDialog').addEventListener('close', () => { state.inquiryEditMode = false; revokeAttachmentPreviews(); });
    el('attachmentPreviewDialog').addEventListener('close', closeAttachmentPreview);
    el('productDialog').addEventListener('close', clearLocalProductPhoto);
    el('inquiryFormDialog').addEventListener('close', clearInquiryProductPhoto);
    window.addEventListener('online', () => toast('Back online'));
    window.addEventListener('offline', () => toast('You are offline. Saved pages remain available.', 'error'));
  }

  async function handleAuth(event) {
    event.preventDefault();
    const button = el('authSubmit');
    button.disabled = true;
    el('authMessage').textContent = '';
    const email = el('authEmail').value.trim();
    const password = el('authPassword').value;
    try {
      if (state.authMode === 'signup') {
        const name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const { data, error } = await db.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) throw error;
        if (!data.session) el('authMessage').textContent = 'Account created. Check your email to confirm it, then sign in.';
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) { showAuthError(friendlyError(error)); }
    finally { button.disabled = false; }
  }

  function toggleAuthMode() {
    state.authMode = state.authMode === 'signin' ? 'signup' : 'signin';
    const signup = state.authMode === 'signup';
    $('.auth-card .eyebrow').textContent = signup ? 'Join the team' : 'Welcome back';
    $('.auth-card h1').textContent = signup ? 'Create your account' : 'Sign in to your workspace';
    el('authSubmit').textContent = signup ? 'Create account' : 'Sign in';
    el('authModeToggle').textContent = signup ? 'Already have an account? Sign in' : 'New team member? Create account';
    el('authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    el('authMessage').textContent = '';
  }

  async function enterApp(user) {
    state.user = user;
    el('authScreen').classList.add('hidden'); el('app').classList.remove('hidden');
    try {
      await loadProfiles();
      await Promise.all([loadInquiries(), loadTasks(), loadNotifications()]);
      subscribeRealtime();
      refreshPushState();
      const launchInquiry = new URL(location.href).searchParams.get('inquiry');
      if (launchInquiry) { history.replaceState({},'',location.pathname); await openInquiryDetail(launchInquiry); }
    } catch (error) { toast(friendlyError(error), 'error'); }
  }

  function showAuth() {
    state.user = null; state.profile = null; state.inquiries = []; state.tasks = []; state.notifications = [];
    if (state.realtimeChannel) db.removeChannel(state.realtimeChannel);
    closePanels(); el('app').classList.add('hidden'); el('authScreen').classList.remove('hidden');
  }

  async function loadProfiles() {
    const { data, error } = await db.from('profiles').select('id,full_name,email,role').order('full_name');
    if (error) throw error;
    state.profiles = data || [];
    state.profile = state.profiles.find(p => p.id === state.user.id) || { full_name: state.user.email?.split('@')[0], email: state.user.email };
    const initials = initialsFor(state.profile.full_name || state.profile.email);
    el('avatarInitials').textContent = initials; el('profileAvatar').textContent = initials;
    el('profileName').textContent = state.profile.full_name || 'Team member'; el('profileEmail').textContent = state.profile.email || '';
    const assignedSelect = $('#inquiryForm [name="assigned_to"]');
    assignedSelect.innerHTML = '<option value="">Unassigned</option>' + state.profiles.map(p => `<option value="${p.id}">${escapeHtml(p.full_name || p.email)}</option>`).join('');
  }

  async function loadInquiries() {
    el('loadingState').classList.remove('hidden'); el('inquiryGrid').innerHTML = '';
    const { data, error } = await db.from('inquiries').select('*, inquiry_items(id,product_name,quantity,quantity_unit,details,sort_order)').order('updated_at', { ascending: false });
    el('loadingState').classList.add('hidden');
    if (error) throw error;
    state.inquiries = data || [];
    renderStats(); renderInquiries();
  }

  async function loadTasks() {
    const { data, error } = await db.from('tasks').select('*, assignee:profiles!tasks_assigned_to_fkey(id,full_name,email), inquiry:inquiries!tasks_inquiry_id_fkey(id,inquiry_no,person_name,company_name)').order('created_at', { ascending: false });
    if (error) throw error;
    state.tasks = data || [];
    renderTaskStats(); renderTasks();
  }

  function renderStats() {
    el('statAll').textContent = state.inquiries.length;
    el('statNew').textContent = state.inquiries.filter(i => i.status === 'new').length;
    el('statQuoted').textContent = state.inquiries.filter(i => i.status === 'quoted').length;
    el('statWon').textContent = state.inquiries.filter(i => i.status === 'won').length;
  }

  function renderTaskStats() {
    const now = new Date(); now.setHours(0,0,0,0);
    const open = state.tasks.filter(t => t.status !== 'done');
    const mine = open.filter(t => t.assigned_to === state.user?.id);
    const overdue = open.filter(t => t.due_date && new Date(`${t.due_date}T00:00:00`) < now);
    el('taskStatOpen').textContent = open.length; el('taskStatMine').textContent = mine.length;
    el('taskStatOverdue').textContent = overdue.length; el('taskStatDone').textContent = state.tasks.length - open.length;
    el('myTaskBadge').textContent = mine.length;
  }

  function renderTasks() {
    const list = el('taskList'); if (!list || !state.user) return;
    const query = el('taskSearchInput').value.trim().toLowerCase(), owner = el('taskOwnerFilter').value, status = el('taskStatusFilter').value;
    let tasks = state.tasks.filter(t => {
      const haystack = [t.title,t.description,t.inquiry?.person_name,t.inquiry?.company_name,formatInquiryNo(t.inquiry?.inquiry_no)].join(' ').toLowerCase();
      const ownerMatch = owner === 'all' || (owner === 'mine' && t.assigned_to === state.user.id) || (owner === 'unassigned' && !t.assigned_to);
      const statusMatch = status === 'all' || (status === 'open' && t.status !== 'done') || t.status === status;
      return ownerMatch && statusMatch && (!query || haystack.includes(query));
    });
    tasks.sort((a,b) => (a.status === 'done') - (b.status === 'done') || taskDueSort(a,b) || new Date(b.created_at)-new Date(a.created_at));
    el('taskEmptyState').classList.toggle('hidden', tasks.length > 0);
    list.innerHTML = tasks.map(taskCardMarkup).join(''); window.lucide?.createIcons();
  }

  function taskDueSort(a,b) { return a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : a.due_date ? -1 : b.due_date ? 1 : 0; }

  function taskCardMarkup(task, compact = false) {
    const overdue = task.status !== 'done' && task.due_date && new Date(`${task.due_date}T23:59:59`) < new Date();
    const assignee = task.assignee || state.profiles.find(p => p.id === task.assigned_to);
    const actions = `<div class="row-actions"><button class="row-action" data-action="edit-task" data-id="${task.id}" aria-label="Edit task" title="Edit task"><i data-lucide="pencil"></i></button><button class="row-action" data-action="delete-task" data-id="${task.id}" aria-label="Delete task" title="Delete task"><i data-lucide="trash-2"></i></button></div>`;
    return `<article class="task-card ${task.status==='done'?'completed':''} ${overdue?'overdue':''}"><button class="task-check" data-action="toggle-task" data-id="${task.id}" aria-label="${task.status==='done'?'Reopen':'Complete'} task"><i data-lucide="${task.status==='done'?'circle-check-big':'circle'}"></i></button><div class="task-card-copy"><div class="task-title-line"><strong>${escapeHtml(task.title)}</strong><span class="task-status status-${task.status}">${taskStatusLabel(task.status)}</span></div>${task.description?`<p>${escapeHtml(task.description)}</p>`:''}<div class="task-meta"><button data-action="view-task-inquiry" data-id="${task.inquiry_id}"><i data-lucide="package-search"></i>${formatInquiryNo(task.inquiry?.inquiry_no || state.activeInquiry?.inquiry_no)} · ${escapeHtml(task.inquiry?.person_name || state.activeInquiry?.person_name || 'Order')}</button><span><i data-lucide="user-round"></i>${escapeHtml(assignee?.full_name || assignee?.email || 'Unassigned')}</span>${task.due_date?`<span class="${overdue?'due-overdue':''}"><i data-lucide="calendar-days"></i>${overdue?'Overdue · ':''}${formatDate(task.due_date+'T00:00:00')}</span>`:''}<span class="priority-pill priority-${task.priority}">${escapeHtml(task.priority)}</span></div></div>${actions}</article>`;
  }

  function renderInquiries() {
    const query = el('searchInput').value.trim().toLowerCase();
    const status = el('statusFilter').value;
    const sort = el('sortSelect').value;
    let rows = state.inquiries.filter(i => {
      const haystack = [i.person_name, i.company_name, i.mobile, i.email, ...(i.inquiry_items || []).map(p => `${p.product_name} ${p.details}`)].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (status === 'all' || i.status === status);
    });
    rows = [...rows].sort((a, b) => sort === 'name_asc' ? a.person_name.localeCompare(b.person_name) : new Date(sort === 'created_desc' ? b.created_at : b.updated_at) - new Date(sort === 'created_desc' ? a.created_at : a.updated_at));
    el('emptyState').classList.toggle('hidden', rows.length > 0);
    el('inquiryGrid').innerHTML = rows.map(inquiryCard).join('');
    window.lucide?.createIcons();
  }

  function inquiryCard(i) {
    const product = [...(i.inquiry_items || [])].sort((a,b) => a.sort_order-b.sort_order)[0];
    const assigned = state.profiles.find(p => p.id === i.assigned_to);
    const company = i.company_name || 'Individual customer';
    return `<article class="inquiry-card" data-id="${i.id}">
      <div class="card-top"><span class="card-number">${formatInquiryNo(i.inquiry_no)}</span><span class="status-pill status-${i.status}">${statusLabels[i.status]}</span></div>
      <div class="card-title"><div><h2>${escapeHtml(i.person_name)}</h2><p>${escapeHtml(company)}</p></div><span class="person-avatar">${initialsFor(i.person_name)}</span></div>
      <div class="product-preview"><strong>${escapeHtml(product?.product_name || 'Product not added')}</strong><span>${product ? `${formatQuantity(product.quantity)} ${escapeHtml(product.quantity_unit || '')} · ${(i.inquiry_items || []).length} product${i.inquiry_items.length === 1 ? '' : 's'}` : 'Open inquiry to add product details'}</span></div>
      <div class="card-meta">${i.mobile ? `<span><i data-lucide="phone"></i>${escapeHtml(i.mobile)}</span>` : ''}<span><i data-lucide="clock-3"></i>${relativeTime(i.updated_at)}</span></div>
      <div class="tag-row"><span class="priority-pill priority-${i.priority}">${escapeHtml(i.priority)} priority</span>${assigned ? `<span class="priority-pill priority-normal">${escapeHtml(assigned.full_name || assigned.email)}</span>` : ''}</div>
      <div class="card-actions"><button class="btn soft wide" data-action="view" data-id="${i.id}"><i data-lucide="eye"></i>View</button></div>
    </article>`;
  }

  function openInquiryForm() {
    clearInquiryProductPhoto(); const form = el('inquiryForm'); form.reset();
    form.querySelector('[name="quantity_unit"]').value = 'pcs'; form.querySelector('[name="quote_currency"]').value = 'USD';
    el('inquiryFormDialog').showModal(); window.lucide?.createIcons();
  }

  async function saveNewInquiry(event) {
    event.preventDefault();
    const form = event.currentTarget, button = el('saveInquiryBtn'); button.disabled = true;
    const fd = new FormData(form);
    const inquiryPayload = {
      person_name: clean(fd.get('person_name')), company_name: clean(fd.get('company_name')), mobile: clean(fd.get('mobile')), email: clean(fd.get('email')),
      customer_address: clean(fd.get('customer_address')), delivery_address: clean(fd.get('delivery_address')), status: fd.get('status'), priority: fd.get('priority'), source: clean(fd.get('source')),
      quote_amount: numberOrNull(fd.get('quote_amount')), quote_currency: fd.get('quote_currency'), quote_notes: clean(fd.get('quote_notes')), payment_notes: clean(fd.get('payment_notes')),
      assigned_to: fd.get('assigned_to') || null, created_by: state.user.id
    };
    try {
      const { data: inquiry, error } = await db.from('inquiries').insert(inquiryPayload).select().single(); if (error) throw error;
      const productName = clean(fd.get('product_name'));
      if (productName) {
        const { data: item, error: itemError } = await db.from('inquiry_items').insert({ inquiry_id: inquiry.id, product_name: productName, quantity: numberOrNull(fd.get('quantity')), quantity_unit: clean(fd.get('quantity_unit')) || 'pcs', details: clean(fd.get('product_details')) }).select().single();
        if (itemError) throw itemError;
        const photo = fd.get('product_photo');
        if (photo instanceof File && photo.size) {
          try { await uploadProductPhoto(photo, item.id, inquiry.id); }
          catch (photoError) { toast(`Inquiry saved, but photo failed: ${friendlyError(photoError)}`, 'error'); }
        }
      }
      await dispatchPush('new_inquiry', inquiry.id);
      el('inquiryFormDialog').close(); toast(`${formatInquiryNo(inquiry.inquiry_no)} created with automatic tasks`); await Promise.all([loadInquiries(), loadTasks()]);
    } catch (error) { toast(friendlyError(error), 'error'); }
    finally { button.disabled = false; }
  }

  async function openInquiryDetail(id) {
    try {
      const dialog = el('inquiryDetailDialog');
      if (!dialog.open || state.activeInquiry?.id !== id) state.inquiryEditMode = false;
      const [inquiryRes, fileRes, commentRes, activityRes] = await Promise.all([
        db.from('inquiries').select('*, inquiry_items(*)').eq('id', id).single(),
        db.from('inquiry_files').select('*').eq('inquiry_id', id).order('created_at', { ascending: false }),
        db.from('inquiry_comments').select('*, author:profiles!inquiry_comments_author_id_fkey(full_name,email)').eq('inquiry_id', id).order('created_at'),
        db.from('activity_events').select('*, actor:profiles!activity_events_actor_id_fkey(full_name,email)').eq('inquiry_id', id).order('created_at', { ascending: false })
      ]);
      if (inquiryRes.error) throw inquiryRes.error; if (fileRes.error) throw fileRes.error; if (commentRes.error) throw commentRes.error; if (activityRes.error) throw activityRes.error;
      state.activeInquiry = { ...inquiryRes.data, inquiry_files: fileRes.data || [], inquiry_comments: commentRes.data || [], activity_events: activityRes.data || [] };
      renderInquiryDetail();
      if (!dialog.open) dialog.showModal();
    } catch (error) { toast(friendlyError(error), 'error'); }
  }

  function renderInquiryDetail(activeTab = 'overview') {
    const i = state.activeInquiry; if (!i) return;
    revokeAttachmentPreviews();
    const assigned = state.profiles.find(p => p.id === i.assigned_to);
    el('inquiryDetailContent').innerHTML = `<div class="detail-wrap">
      <div class="detail-hero"><div class="detail-hero-top"><span class="card-number">${formatInquiryNo(i.inquiry_no)} · Added ${formatDate(i.created_at)}</span><div class="detail-hero-actions"><button class="btn ${state.inquiryEditMode?'soft':'primary'} small" data-action="toggle-inquiry-edit"><i data-lucide="${state.inquiryEditMode?'check':'pencil'}"></i>${state.inquiryEditMode?'Done':'Edit'}</button><button class="icon-btn" data-dialog-close="inquiryDetailDialog" aria-label="Close"><i data-lucide="x"></i></button></div></div><div class="detail-title-row"><div><h2>${escapeHtml(i.person_name)}</h2><p>${escapeHtml(i.company_name || 'Individual customer')}</p></div><div class="tag-row"><span class="status-pill status-${i.status}">${statusLabels[i.status]}</span><span class="priority-pill priority-${i.priority}">${escapeHtml(i.priority)}</span></div></div></div>
      <nav class="detail-tabs" aria-label="Inquiry details"><button class="detail-tab ${activeTab==='overview'?'active':''}" data-detail-tab="overview">Overview</button><button class="detail-tab ${activeTab==='timeline'?'active':''}" data-detail-tab="timeline">Timeline (${(i.activity_events||[]).length})</button><button class="detail-tab ${activeTab==='tasks'?'active':''}" data-detail-tab="tasks">Tasks (${tasksForInquiry(i.id).length})</button><button class="detail-tab ${activeTab==='products'?'active':''}" data-detail-tab="products">Products (${(i.inquiry_items||[]).length})</button><button class="detail-tab ${activeTab==='files'?'active':''}" data-detail-tab="files">Attachments (${(i.inquiry_files||[]).length})</button><button class="detail-tab ${activeTab==='comments'?'active':''}" data-detail-tab="comments">Comments (${(i.inquiry_comments||[]).length})</button></nav>
      <div class="detail-scroll">
        <section class="detail-panel ${activeTab==='overview'?'active':''}" data-panel="overview">${overviewMarkup(i,assigned)}</section>
        <section class="detail-panel ${activeTab==='timeline'?'active':''}" data-panel="timeline">${timelineMarkup(i)}</section>
        <section class="detail-panel ${activeTab==='tasks'?'active':''}" data-panel="tasks">${inquiryTasksMarkup(i)}</section>
        <section class="detail-panel ${activeTab==='products'?'active':''}" data-panel="products">${productsMarkup(i)}</section>
        <section class="detail-panel ${activeTab==='files'?'active':''}" data-panel="files">${filesMarkup(i)}</section>
        <section class="detail-panel ${activeTab==='comments'?'active':''}" data-panel="comments">${commentsMarkup(i)}</section>
      </div></div>`;
    window.lucide?.createIcons();
    if (activeTab === 'files' || activeTab === 'products') hydrateAttachmentPreviews(i.id);
  }

  function overviewMarkup(i, assigned) {
    return `<div class="detail-grid">
      ${detailSection('user-round','Customer & contact', [['person_name',i.person_name],['company_name',i.company_name],['mobile',i.mobile],['email',i.email]])}
      ${detailSection('map-pin','Addresses', [['customer_address',i.customer_address],['delivery_address',i.delivery_address]])}
      ${detailSection('badge-dollar-sign','Quote & payment', [['quote_amount',formatMoney(i.quote_amount,i.quote_currency),i.quote_amount],['quote_currency',i.quote_currency],['quote_notes',i.quote_notes],['payment_notes',i.payment_notes]], true)}
      ${detailSection('sliders-horizontal','Management', [['status',statusLabels[i.status],i.status],['priority',capitalize(i.priority),i.priority],['source',i.source],['assigned_to',assigned?.full_name||assigned?.email||'Unassigned',i.assigned_to]], true)}
    </div>`;
  }

  function timelineMarkup(inquiry) {
    const events = inquiry.activity_events || [];
    return `<article class="detail-section full"><div class="detail-section-head"><div><i data-lucide="history"></i><h3>Complete activity timeline</h3></div></div><div class="activity-timeline">${events.length ? events.map(activityEventMarkup).join('') : '<div class="empty-inline">No activity recorded yet.</div>'}</div></article>`;
  }

  function activityEventMarkup(event) {
    const actor = event.actor?.full_name || event.actor?.email || 'System';
    const icon = event.event_type.startsWith('task_') ? 'list-checks' : event.event_type.startsWith('comment_') ? 'message-square' : event.event_type.startsWith('file_') ? 'paperclip' : event.event_type.startsWith('product_') ? 'package' : event.event_type === 'inquiry_created' ? 'sparkles' : 'pencil';
    return `<div class="activity-event"><span class="activity-icon"><i data-lucide="${icon}"></i></span><div><div class="activity-event-head"><strong>${escapeHtml(event.title)}</strong><time>${formatDateTime(event.created_at)}</time></div>${event.details?`<p>${escapeHtml(event.details)}</p>`:''}<small>${escapeHtml(actor)}</small></div></div>`;
  }

  function detailSection(icon,title,rows) {
    return `<article class="detail-section"><div class="detail-section-head"><div><i data-lucide="${icon}"></i><h3>${title}</h3></div></div><div class="field-list">${rows.map(([field,display,raw]) => `<div class="field-row"><div><label>${fieldMeta[field].label}</label><p>${escapeHtml(display || 'Not added')}</p></div>${state.inquiryEditMode?`<button class="edit-field-btn" data-action="edit-field" data-field="${field}" data-value="${escapeAttr(raw ?? display ?? '')}" aria-label="Edit ${fieldMeta[field].label}"><i data-lucide="pencil"></i></button>`:''}</div>`).join('')}</div></article>`;
  }

  function productsMarkup(i) {
    const products = [...(i.inquiry_items||[])].sort((a,b)=>a.sort_order-b.sort_order);
    return `<article class="detail-section full"><div class="detail-section-head"><div><i data-lucide="package-open"></i><h3>Products requested</h3></div><button class="btn soft small" data-action="add-product"><i data-lucide="plus"></i>Add product</button></div><div class="products-list">${products.length ? products.map(p => productRowMarkup(i,p)).join('') : '<div class="empty-inline">No products added yet.</div>'}</div></article>`;
  }

  function productRowMarkup(inquiry, product) {
    const photo = (inquiry.inquiry_files||[]).find(file => file.file_kind === 'product_photo' && file.product_id === product.id);
    const visual = photo ? `<button class="product-thumb" data-action="preview-file" data-id="${photo.id}" aria-label="View ${escapeAttr(product.product_name)} photo"><span class="thumbnail-loading" data-file-preview="${photo.id}" data-preview-kind="image"><i data-lucide="image"></i></span></button>` : `<span class="product-icon"><i data-lucide="package"></i></span>`;
    return `<div class="product-row">${visual}<div><strong>${escapeHtml(product.product_name)}</strong><p>${formatQuantity(product.quantity)} ${escapeHtml(product.quantity_unit||'')} ${product.details?`· ${escapeHtml(product.details)}`:''}</p>${photo?'<button class="product-photo-link" data-action="preview-file" data-id="'+photo.id+'">Tap photo to view</button>':''}</div>${state.inquiryEditMode?`<div class="row-actions"><button class="row-action" data-action="edit-product" data-id="${product.id}" aria-label="Edit product"><i data-lucide="pencil"></i></button><button class="row-action" data-action="delete-product" data-id="${product.id}" aria-label="Delete product"><i data-lucide="trash-2"></i></button></div>`:''}</div>`;
  }

  function tasksForInquiry(inquiryId) { return state.tasks.filter(task => task.inquiry_id === inquiryId); }

  function inquiryTasksMarkup(inquiry) {
    const tasks = tasksForInquiry(inquiry.id).sort((a,b) => (a.status === 'done') - (b.status === 'done') || taskDueSort(a,b) || a.sort_order-b.sort_order);
    return `<article class="detail-section full"><div class="detail-section-head"><div><i data-lucide="list-checks"></i><h3>Order tasks</h3></div><button class="btn soft small" data-action="add-task" data-id="${inquiry.id}"><i data-lucide="plus"></i>Add task</button></div><div class="inquiry-task-list">${tasks.length ? tasks.map(task => taskCardMarkup(task,true)).join('') : '<div class="empty-inline">No tasks added to this order yet.</div>'}</div></article>`;
  }

  function filesMarkup(i) {
    const categories = [
      ['client_photo', 'Client photos', 'image'],
      ['shared_photo', 'Photos shared to client', 'send'],
      ['quote', 'Quote', 'file-text'],
      ['payment_proof', 'Payment proof', 'receipt-text']
    ];
    return `<div class="attachment-windows">${categories.map(([kind,label,icon]) => attachmentWindowMarkup(i, kind, label, icon)).join('')}</div>`;
  }

  function attachmentWindowMarkup(inquiry, kind, label, icon) {
    const files = (inquiry.inquiry_files || []).filter(file => file.file_kind === kind);
    return `<article class="attachment-window"><div class="attachment-window-head"><div class="attachment-window-title"><span><i data-lucide="${icon}"></i></span><div><h3>${escapeHtml(label)}</h3><p>${files.length} file${files.length===1?'':'s'}</p></div></div><label class="attachment-add-btn"><i data-lucide="plus"></i><span>Add</span><input type="file" data-upload-kind="${kind}" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" multiple></label></div><div class="attachment-window-list">${files.length ? files.map(fileMarkup).join('') : `<div class="attachment-window-empty"><i data-lucide="upload-cloud"></i><strong>No ${escapeHtml(label.toLowerCase())} yet</strong><span>Use Add to upload files</span></div>`}</div></article>`;
  }

  function fileMarkup(file) {
    const isImage = file.mime_type?.startsWith('image/');
    const isPdf = file.mime_type === 'application/pdf';
    const canPreview = isImage || isPdf;
    const thumbnail = canPreview
      ? `<button class="file-thumbnail ${isPdf?'pdf-thumbnail':''}" data-action="preview-file" data-id="${file.id}" aria-label="Preview ${escapeAttr(file.file_name)}"><span class="thumbnail-loading" data-file-preview="${file.id}" data-preview-kind="${isImage?'image':'pdf'}"><i data-lucide="${isImage?'image':'file-text'}"></i>${isPdf?'<b>PDF</b>':''}</span></button>`
      : `<span class="file-thumbnail static"><span><i data-lucide="file-text"></i></span></span>`;
    return `<div class="file-tile">${thumbnail}<div class="file-tile-footer"><strong title="${escapeAttr(file.file_name)}">${escapeHtml(file.file_name)}</strong><div class="row-actions"><button class="row-action" data-action="download-file" data-id="${file.id}" aria-label="Download ${escapeAttr(file.file_name)}"><i data-lucide="download"></i></button><button class="row-action" data-action="delete-file" data-id="${file.id}" aria-label="Delete ${escapeAttr(file.file_name)}"><i data-lucide="trash-2"></i></button></div></div></div>`;
  }

  function commentsMarkup(i) {
    return `<div class="comments-shell"><article class="detail-section"><div class="detail-section-head"><div><i data-lucide="messages-square"></i><h3>Team conversation</h3></div></div><div class="comments-list">${(i.inquiry_comments||[]).length ? i.inquiry_comments.map(c => `<div class="comment-card"><div class="comment-head"><strong>${escapeHtml(c.author?.full_name||c.author?.email||'Team member')}</strong><time>${formatDateTime(c.created_at)}</time></div><p>${escapeHtml(c.body)}</p></div>`).join('') : '<div class="empty-inline">No comments yet. Start the conversation.</div>'}</div></article><form id="commentForm" class="comment-composer"><h3>Add a comment</h3><p class="muted">Every team member will receive a notification.</p><textarea name="body" maxlength="3000" required placeholder="Write an update, question or note…"></textarea><button class="btn primary wide" type="submit"><i data-lucide="send"></i>Post comment</button></form></div>`;
  }

  function handleDelegatedClick(event) {
    const close = event.target.closest('[data-close]'); if (close) return closePanels();
    const dialogClose = event.target.closest('[data-dialog-close]'); if (dialogClose) return el(dialogClose.dataset.dialogClose).close();
    const workspaceView = event.target.closest('[data-workspace-view]'); if (workspaceView) return switchWorkspace(workspaceView.dataset.workspaceView);
    const tab = event.target.closest('[data-detail-tab]'); if (tab) return renderInquiryDetail(tab.dataset.detailTab);
    const action = event.target.closest('[data-action]');
    if (action) {
      const id = action.dataset.id, type = action.dataset.action;
      if (type === 'add-inquiry') return openInquiryForm();
      if (type === 'view') return openInquiryDetail(id);
      if (type === 'toggle-inquiry-edit') { state.inquiryEditMode = !state.inquiryEditMode; return renderInquiryDetail($('.detail-tab.active')?.dataset.detailTab || 'overview'); }
      if (type === 'edit-field') return openFieldEdit(action.dataset.field, action.dataset.value);
      if (type === 'add-product') return openProductForm();
      if (type === 'edit-product') return openProductForm((state.activeInquiry.inquiry_items||[]).find(p=>p.id===id));
      if (type === 'delete-product') return deleteProduct(id);
      if (type === 'add-task') return openTaskForm(null, id);
      if (type === 'add-task-global') return openTaskForm();
      if (type === 'edit-task') return openTaskForm(state.tasks.find(task => task.id === id));
      if (type === 'delete-task') return deleteTask(id);
      if (type === 'toggle-task') return toggleTask(id);
      if (type === 'view-task-inquiry') { el('taskDialog').open && el('taskDialog').close(); return openInquiryDetail(id); }
      if (type === 'preview-file') return openAttachmentPreview(id);
      if (type === 'preview-local-product-photo') return openLocalProductPhotoPreview(action.dataset.localSource);
      if (type === 'download-file') return downloadFile(id);
      if (type === 'delete-file') return deleteFile(id);
    }
    const notification = event.target.closest('.notification-item'); if (notification) openNotification(notification.dataset.id, notification.dataset.inquiryId);
  }

  function switchWorkspace(view) {
    state.currentView = view;
    el('inquiryWorkspace').classList.toggle('hidden', view !== 'inquiries'); el('taskWorkspace').classList.toggle('hidden', view !== 'tasks');
    $$('[data-workspace-view]').forEach(button => button.classList.toggle('active', button.dataset.workspaceView === view));
    el('mobileAddBtn').setAttribute('aria-label', view === 'tasks' ? 'Add task' : 'Add inquiry');
    if (view === 'tasks') renderTasks();
  }

  document.addEventListener('change', event => {
    if (event.target.id === 'productPhotoInput') return showLocalProductPhoto(event.target.files?.[0]);
    if (event.target.id === 'inquiryProductPhotoInput') return showInquiryProductPhoto(event.target.files?.[0]);
    const input = event.target.closest('[data-upload-kind]');
    if (input?.files?.length) uploadFiles(input.files, input.dataset.uploadKind, input);
  });
  document.addEventListener('submit', event => { if (event.target.id === 'commentForm') { event.preventDefault(); addComment(event.target); } });

  function openFieldEdit(field, value) {
    const meta = fieldMeta[field]; state.fieldEdit = { field };
    el('fieldEditTitle').textContent = meta.label;
    let control;
    if (meta.type === 'textarea') control = `<label>${meta.label}<textarea name="value" rows="5" ${meta.required?'required':''}>${escapeHtml(value)}</textarea></label>`;
    else if (meta.type === 'select') control = `<label>${meta.label}<select name="value">${Object.entries(meta.options).map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label>`;
    else if (meta.type === 'profile') control = `<label>${meta.label}<select name="value"><option value="">Unassigned</option>${state.profiles.map(p=>`<option value="${p.id}" ${p.id===value?'selected':''}>${escapeHtml(p.full_name||p.email)}</option>`).join('')}</select></label>`;
    else control = `<label>${meta.label}<input name="value" type="${meta.type||'text'}" value="${escapeAttr(value)}" ${meta.required?'required':''} ${meta.type==='number'?'min="0" step="0.01"':''}></label>`;
    el('fieldEditControl').innerHTML = control; el('fieldEditDialog').showModal(); setTimeout(()=>$('#fieldEditControl [name="value"]')?.focus(),50);
  }

  async function saveFieldEdit(event) {
    event.preventDefault(); const field = state.fieldEdit?.field; if (!field || !state.activeInquiry) return;
    let value = new FormData(event.currentTarget).get('value');
    if (field === 'assigned_to') value = value || null; else if (field === 'quote_amount') value = numberOrNull(value); else value = clean(value);
    try {
      const { error } = await db.from('inquiries').update({ [field]: value }).eq('id', state.activeInquiry.id); if (error) throw error;
      el('fieldEditDialog').close(); toast(`${fieldMeta[field].label} updated`); await refreshActiveInquiry('overview');
    } catch (error) { toast(friendlyError(error), 'error'); }
  }

  function openProductForm(product = null) {
    clearLocalProductPhoto(); state.productEdit = product || null; const form = el('productForm'); form.reset(); form.quantity_unit.value = 'pcs';
    el('productFormTitle').textContent = product ? 'Edit product' : 'Add product';
    if (product) { form.product_name.value=product.product_name; form.quantity.value=product.quantity??''; form.quantity_unit.value=product.quantity_unit||'pcs'; form.details.value=product.details||''; }
    const existingPhoto = product && (state.activeInquiry.inquiry_files||[]).find(file => file.file_kind === 'product_photo' && file.product_id === product.id);
    if (existingPhoto) { el('productPhotoPreview').classList.remove('hidden'); el('productPhotoPreview').innerHTML = `<button type="button" data-action="preview-file" data-id="${existingPhoto.id}"><i data-lucide="image"></i><span>Current photo</span><small>Tap to view · choose another to replace</small></button>`; }
    el('productDialog').showModal();
    window.lucide?.createIcons();
  }

  async function saveProduct(event) {
    event.preventDefault(); const fd = new FormData(event.currentTarget), payload = { product_name: clean(fd.get('product_name')), quantity: numberOrNull(fd.get('quantity')), quantity_unit: clean(fd.get('quantity_unit'))||'pcs', details: clean(fd.get('details')) };
    try {
      let result;
      if (state.productEdit) result = await db.from('inquiry_items').update(payload).eq('id', state.productEdit.id).select().single();
      else result = await db.from('inquiry_items').insert({ ...payload, inquiry_id: state.activeInquiry.id, sort_order: state.activeInquiry.inquiry_items?.length || 0 }).select().single();
      if (result.error) throw result.error;
      const photo = fd.get('product_photo');
      let photoSaved = false;
      if (photo instanceof File && photo.size) {
        try { await uploadProductPhoto(photo, result.data.id); photoSaved = true; }
        catch (photoError) { toast(`Product saved, but photo failed: ${friendlyError(photoError)}`, 'error'); }
      }
      el('productDialog').close(); if (!(photo instanceof File && photo.size) || photoSaved) toast(photoSaved ? 'Product and photo saved' : 'Product saved'); await refreshActiveInquiry('products');
    } catch (error) { toast(friendlyError(error), 'error'); }
  }

  async function deleteProduct(id) {
    if (!confirm('Delete this product from the inquiry?')) return;
    const photo = (state.activeInquiry.inquiry_files||[]).find(file => file.file_kind === 'product_photo' && file.product_id === id);
    if (photo) { const removed = await deleteFileRequest(photo.id); if (!removed) return; }
    const { error } = await db.from('inquiry_items').delete().eq('id', id); if (error) return toast(friendlyError(error),'error');
    toast('Product deleted'); await refreshActiveInquiry('products');
  }

  async function uploadProductPhoto(file, productId, inquiryId = state.activeInquiry?.id) {
    if (!cfg.attachmentApiUrl) throw new Error('Attachment service is not configured.');
    if (!inquiryId) throw new Error('Inquiry could not be identified.');
    const { data: { session } } = await db.auth.getSession(); if (!session) throw new Error('Sign in is required');
    const body = new FormData(); body.append('file',file); body.append('file_kind','product_photo'); body.append('product_id',productId);
    const response = await fetch(`${cfg.attachmentApiUrl}/inquiries/${inquiryId}/files`, { method:'POST', headers:{ Authorization:`Bearer ${session.access_token}` }, body });
    if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || `Photo upload failed (${response.status})`);
  }

  function showLocalProductPhoto(file) {
    clearLocalProductPhoto(); if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Choose an image file.', 'error');
    state.localProductPhotoUrl = URL.createObjectURL(file); el('productPhotoPreview').classList.remove('hidden');
    el('productPhotoPreview').innerHTML = `<button type="button" data-action="preview-local-product-photo" data-local-source="product"><img src="${escapeAttr(state.localProductPhotoUrl)}" alt="Selected product photo"><span>${escapeHtml(file.name)}</span><small>Tap to view larger</small></button>`;
  }

  function showInquiryProductPhoto(file) {
    clearInquiryProductPhoto(); if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Choose an image file.', 'error');
    state.inquiryProductPhotoUrl = URL.createObjectURL(file); el('inquiryProductPhotoPreview').classList.remove('hidden');
    el('inquiryProductPhotoPreview').innerHTML = `<button type="button" data-action="preview-local-product-photo" data-local-source="inquiry"><img src="${escapeAttr(state.inquiryProductPhotoUrl)}" alt="Selected product photo"><span>${escapeHtml(file.name)}</span><small>Tap to view larger</small></button>`;
  }

  function clearLocalProductPhoto() {
    if (state.localProductPhotoUrl) URL.revokeObjectURL(state.localProductPhotoUrl); state.localProductPhotoUrl = null;
    const preview = el('productPhotoPreview'); if (preview) { preview.replaceChildren(); preview.classList.add('hidden'); }
  }

  function clearInquiryProductPhoto() {
    if (state.inquiryProductPhotoUrl) URL.revokeObjectURL(state.inquiryProductPhotoUrl); state.inquiryProductPhotoUrl = null;
    const preview = el('inquiryProductPhotoPreview'); if (preview) { preview.replaceChildren(); preview.classList.add('hidden'); }
  }

  function openLocalProductPhotoPreview(source = 'product') {
    const url = source === 'inquiry' ? state.inquiryProductPhotoUrl : state.localProductPhotoUrl; if (!url) return;
    state.activeLocalPhotoUrl = url;
    const dialog = el('attachmentPreviewDialog'), body = el('attachmentPreviewBody'); state.openPreviewFileId = null;
    el('attachmentPreviewTitle').textContent = 'Selected product photo'; body.innerHTML = `<img src="${escapeAttr(url)}" alt="Selected product photo">`;
    el('previewDownloadBtn').classList.add('hidden'); if (!dialog.open) dialog.showModal();
  }

  function openTaskForm(task = null, inquiryId = null) {
    state.taskEdit = task || null; const form = el('taskForm'), field = name => form.elements.namedItem(name); form.reset();
    el('taskFormTitle').textContent = task ? 'Edit task' : 'Add task';
    field('inquiry_id').innerHTML = state.inquiries.map(i => `<option value="${i.id}">${formatInquiryNo(i.inquiry_no)} · ${escapeHtml(i.person_name)}${i.company_name?` · ${escapeHtml(i.company_name)}`:''}</option>`).join('');
    field('assigned_to').innerHTML = '<option value="">Unassigned</option>' + state.profiles.map(p => `<option value="${p.id}">${escapeHtml(p.full_name || p.email)}</option>`).join('');
    const selectedInquiry = task?.inquiry_id || inquiryId || state.activeInquiry?.id || state.inquiries[0]?.id;
    if (!selectedInquiry) return toast('Create an inquiry before adding tasks.', 'error');
    field('inquiry_id').value = selectedInquiry;
    if (task) {
      field('title').value = task.title; field('description').value = task.description || ''; field('assigned_to').value = task.assigned_to || '';
      field('status').value = task.status; field('priority').value = task.priority; field('due_date').value = task.due_date || '';
    } else {
      const inquiry = state.inquiries.find(i => i.id === selectedInquiry);
      field('status').value = 'todo'; field('priority').value = 'normal'; field('assigned_to').value = inquiry?.assigned_to || state.user.id;
    }
    el('taskDialog').showModal(); setTimeout(() => field('title').focus(), 50);
  }

  async function saveTask(event) {
    event.preventDefault(); const form = event.currentTarget, fd = new FormData(form), button = el('saveTaskBtn'); button.disabled = true;
    const payload = { inquiry_id: fd.get('inquiry_id'), title: clean(fd.get('title')), description: clean(fd.get('description')), assigned_to: fd.get('assigned_to') || null, status: fd.get('status'), priority: fd.get('priority'), due_date: fd.get('due_date') || null };
    try {
      let result;
      if (state.taskEdit) result = await db.from('tasks').update(payload).eq('id', state.taskEdit.id);
      else result = await db.from('tasks').insert({ ...payload, created_by: state.user.id });
      if (result.error) throw result.error;
      const inquiryId = payload.inquiry_id;
      const previous = state.taskEdit;
      if (payload.assigned_to && (!previous || previous.assigned_to !== payload.assigned_to)) await dispatchPush('task_assigned', inquiryId);
      if (payload.status === 'done' && previous?.status !== 'done') await dispatchPush('task_done', inquiryId);
      el('taskDialog').close(); toast(state.taskEdit ? 'Task updated' : 'Task added'); await loadTasks();
      if (state.activeInquiry?.id === inquiryId && el('inquiryDetailDialog').open) renderInquiryDetail('tasks');
    } catch (error) { toast(friendlyError(error), 'error'); }
    finally { button.disabled = false; }
  }

  async function toggleTask(id) {
    const task = state.tasks.find(item => item.id === id); if (!task) return;
    const status = task.status === 'done' ? 'todo' : 'done';
    const { error } = await db.from('tasks').update({ status }).eq('id', id); if (error) return toast(friendlyError(error), 'error');
    if (status === 'done') await dispatchPush('task_done', task.inquiry_id);
    toast(status === 'done' ? 'Task completed' : 'Task reopened'); await loadTasks();
    if (state.activeInquiry?.id === task.inquiry_id && el('inquiryDetailDialog').open) renderInquiryDetail('tasks');
  }

  async function deleteTask(id) {
    const task = state.tasks.find(item => item.id === id); if (!task || !confirm(`Delete task “${task.title}”?`)) return;
    const { error } = await db.from('tasks').delete().eq('id', id); if (error) return toast(friendlyError(error), 'error');
    toast('Task deleted'); await loadTasks();
    if (state.activeInquiry?.id === task.inquiry_id && el('inquiryDetailDialog').open) renderInquiryDetail('tasks');
  }

  async function uploadFiles(fileList, kind, input) {
    if (!cfg.attachmentApiUrl) return toast('Attachment service is not configured.', 'error');
    input.disabled = true;
    try {
      const { data: { session } } = await db.auth.getSession();
      for (const file of [...fileList]) {
        const body = new FormData(); body.append('file',file); body.append('file_kind',kind);
        const response = await fetch(`${cfg.attachmentApiUrl}/inquiries/${state.activeInquiry.id}/files`, { method:'POST', headers:{ Authorization:`Bearer ${session.access_token}` }, body });
        if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || `Upload failed (${response.status})`);
      }
      toast(`${fileList.length} file${fileList.length===1?'':'s'} uploaded`); await refreshActiveInquiry('files');
    } catch (error) { toast(friendlyError(error),'error'); }
    finally { input.disabled=false; input.value=''; }
  }

  async function hydrateAttachmentPreviews(inquiryId) {
    const requestId = ++state.attachmentPreviewRequest;
    const files = (state.activeInquiry?.inquiry_files || []).filter(file => file.mime_type?.startsWith('image/') || file.mime_type === 'application/pdf');
    if (!files.length) return;
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;
      for (const file of files) {
        if (requestId !== state.attachmentPreviewRequest || inquiryId !== state.activeInquiry?.id) return;
        const url = await fetchAttachmentUrl(file.id, session.access_token);
        if (requestId !== state.attachmentPreviewRequest || inquiryId !== state.activeInquiry?.id) { URL.revokeObjectURL(url); return; }
        state.attachmentPreviewUrls.set(file.id, url);
        const host = $$('[data-file-preview]').find(node => node.dataset.filePreview === file.id);
        if (!host) continue;
        host.replaceChildren();
        if (file.mime_type?.startsWith('image/')) {
          const image = document.createElement('img'); image.src = url; image.alt = ''; image.loading = 'lazy'; host.append(image);
        } else {
          const object = document.createElement('object'); object.data = `${url}#page=1&view=FitH&toolbar=0&navpanes=0&scrollbar=0`; object.type = 'application/pdf'; object.tabIndex = -1;
          const fallback = document.createElement('span'); fallback.className = 'pdf-fallback'; fallback.innerHTML = '<b>PDF</b>';
          object.append(fallback); host.append(object);
          const badge = document.createElement('b'); badge.className = 'pdf-badge'; badge.textContent = 'PDF'; host.append(badge);
        }
      }
    } catch (error) {
      if (requestId === state.attachmentPreviewRequest) $$('.thumbnail-loading').forEach(node => node.classList.add('preview-unavailable'));
    }
  }

  async function fetchAttachmentUrl(id, accessToken) {
    const response = await fetch(`${cfg.attachmentApiUrl}/inquiries/${state.activeInquiry.id}/files/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Preview could not be loaded');
    return URL.createObjectURL(await response.blob());
  }

  async function openAttachmentPreview(id) {
    const file = (state.activeInquiry?.inquiry_files || []).find(item => item.id === id); if (!file) return;
    const dialog = el('attachmentPreviewDialog'), body = el('attachmentPreviewBody');
    state.openPreviewFileId = id; el('attachmentPreviewTitle').textContent = file.file_name; el('previewDownloadBtn').classList.remove('hidden');
    body.innerHTML = '<div class="preview-loading"><span class="spinner"></span><strong>Loading preview…</strong></div>';
    if (!dialog.open) dialog.showModal();
    try {
      let url = state.attachmentPreviewUrls.get(id);
      if (!url) {
        const { data: { session } } = await db.auth.getSession();
        if (!session) throw new Error('Sign in is required');
        url = await fetchAttachmentUrl(id, session.access_token); state.attachmentPreviewUrls.set(id, url);
      }
      if (state.openPreviewFileId !== id || !dialog.open) return;
      body.replaceChildren();
      if (file.mime_type?.startsWith('image/')) {
        const image = document.createElement('img'); image.src = url; image.alt = file.file_name; body.append(image);
      } else if (file.mime_type === 'application/pdf') {
        const frame = document.createElement('iframe'); frame.src = `${url}#view=FitH`; frame.title = file.file_name; body.append(frame);
      }
      el('previewDownloadBtn').dataset.id = id;
    } catch (error) { body.innerHTML = `<div class="preview-error"><i data-lucide="circle-alert"></i><strong>${escapeHtml(friendlyError(error))}</strong></div>`; window.lucide?.createIcons(); }
  }

  function closeAttachmentPreview() { state.openPreviewFileId = null; el('attachmentPreviewBody').replaceChildren(); }

  function revokeAttachmentPreviews() {
    state.attachmentPreviewRequest += 1;
    state.attachmentPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    state.attachmentPreviewUrls.clear();
    if (el('attachmentPreviewDialog')?.open) el('attachmentPreviewDialog').close();
  }

  async function downloadFile(id) {
    try {
      const { data: { session } } = await db.auth.getSession();
      const response = await fetch(`${cfg.attachmentApiUrl}/inquiries/${state.activeInquiry.id}/files/${id}`, { headers:{ Authorization:`Bearer ${session.access_token}` } });
      if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || 'Download failed');
      const blob = await response.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href=url; a.download=state.activeInquiry.inquiry_files.find(f=>f.id===id)?.file_name||'attachment'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error){ toast(friendlyError(error),'error'); }
  }

  async function deleteFile(id) {
    if (!confirm('Delete this attachment permanently?')) return;
    if (!await deleteFileRequest(id)) return;
    toast('Attachment deleted'); await refreshActiveInquiry('files');
  }

  async function deleteFileRequest(id) {
    try {
      const { data: { session } } = await db.auth.getSession();
      const response = await fetch(`${cfg.attachmentApiUrl}/inquiries/${state.activeInquiry.id}/files/${id}`, { method:'DELETE', headers:{ Authorization:`Bearer ${session.access_token}` } });
      if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || 'Delete failed');
      return true;
    } catch(error){ toast(friendlyError(error),'error'); return false; }
  }

  async function addComment(form) {
    const body = clean(new FormData(form).get('body')); if (!body) return;
    const button=form.querySelector('button'); button.disabled=true;
    try {
      const { error }=await db.from('inquiry_comments').insert({ inquiry_id:state.activeInquiry.id, body, author_id:state.user.id }); if(error) throw error;
      await dispatchPush('comment', state.activeInquiry.id);
      form.reset(); toast('Comment posted — team notified'); await refreshActiveInquiry('comments');
    } catch(error){toast(friendlyError(error),'error')} finally{button.disabled=false}
  }

  async function refreshActiveInquiry(tab) {
    const id=state.activeInquiry.id; await loadInquiries(); await openInquiryDetail(id); renderInquiryDetail(tab);
  }

  async function loadNotifications() {
    const { data,error }=await db.from('notifications').select('*').order('created_at',{ascending:false}).limit(80); if(error) throw error;
    state.notifications=data||[]; renderNotifications();
  }

  function renderNotifications() {
    const unread=state.notifications.filter(n=>!n.is_read).length; el('notificationCount').textContent=unread>99?'99+':unread; el('notificationCount').classList.toggle('hidden',!unread);
    el('notificationList').innerHTML=state.notifications.length?state.notifications.map(n=>`<article class="notification-item ${n.is_read?'':'unread'}" data-id="${n.id}" data-inquiry-id="${n.inquiry_id||''}"><span class="notification-dot"></span><div><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.message)}</p><time>${relativeTime(n.created_at)}</time></div></article>`).join(''):'<div class="empty-inline">You are all caught up.</div>';
  }

  function subscribeRealtime() {
    if(state.realtimeChannel) db.removeChannel(state.realtimeChannel);
    state.realtimeChannel=db.channel(`notifications:${state.user.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`recipient_id=eq.${state.user.id}`},payload=>{
      state.notifications.unshift(payload.new); renderNotifications(); toast(payload.new.title); if(!state.pushEnabled) showSystemNotification(payload.new);
    }).subscribe();
  }

  async function openNotification(id,inquiryId) {
    const item=state.notifications.find(n=>n.id===id); if(item&&!item.is_read){await db.from('notifications').update({is_read:true}).eq('id',id);item.is_read=true;renderNotifications()}
    closePanels(); if(inquiryId) openInquiryDetail(inquiryId);
  }
  async function markAllRead(){const ids=state.notifications.filter(n=>!n.is_read).map(n=>n.id);if(!ids.length)return;const{error}=await db.from('notifications').update({is_read:true}).in('id',ids);if(error)return toast(friendlyError(error),'error');state.notifications.forEach(n=>n.is_read=true);renderNotifications()}
  async function enableBrowserAlerts(){
    if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))return toast('Background push is not supported on this device.','error');
    const button=el('enableAlertsBtn');button.disabled=true;
    try{
      const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notification permission was not enabled');
      const {data:{session}}=await db.auth.getSession();if(!session)throw new Error('Please sign in again');
      const response=await fetch(`${cfg.supabaseUrl}/functions/v1/send-push`,{headers:{Authorization:`Bearer ${session.access_token}`}});if(!response.ok)throw new Error('Push service could not be reached');
      const {publicKey}=await response.json();if(!publicKey)throw new Error('Push service is not configured');
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
      const json=subscription.toJSON(),payload={user_id:state.user.id,endpoint:subscription.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth,user_agent:navigator.userAgent};
      const {error}=await db.from('push_subscriptions').upsert(payload,{onConflict:'endpoint'});if(error)throw error;
      state.pushEnabled=true;button.innerHTML='<i data-lucide="bell-check"></i>Background alerts enabled';window.lucide?.createIcons();toast('Background push notifications enabled');
    }catch(error){toast(friendlyError(error),'error')}finally{button.disabled=false}
  }
  async function dispatchPush(kind,inquiryId){
    try{
      const {data:{session}}=await db.auth.getSession();if(!session)return;
      const response=await fetch(`${cfg.supabaseUrl}/functions/v1/send-push`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({kind,inquiry_id:inquiryId})});
      if(!response.ok)console.warn('Push dispatch failed',response.status);
    }catch(error){console.warn('Push dispatch failed',error)}
  }
  async function refreshPushState(){try{const registration=await navigator.serviceWorker?.ready;state.pushEnabled=!!(await registration?.pushManager?.getSubscription());if(state.pushEnabled){el('enableAlertsBtn').innerHTML='<i data-lucide="bell-check"></i>Background alerts enabled';window.lucide?.createIcons()}}catch{state.pushEnabled=false}}
  async function showSystemNotification(n){if(!('Notification'in window)||Notification.permission!=='granted')return;const reg=await navigator.serviceWorker?.ready.catch(()=>null);if(reg)reg.showNotification(n.title,{body:n.message,icon:'assets/icon-192.png',badge:'assets/icon-192.png',tag:n.id,data:{inquiryId:n.inquiry_id}});else new Notification(n.title,{body:n.message})}

  function openPanel(id){closePanels();el(id).classList.add('open');el(id).setAttribute('aria-hidden','false');el('scrim').classList.remove('hidden')}
  function closePanels(){$$('.side-panel').forEach(p=>{p.classList.remove('open');p.setAttribute('aria-hidden','true')});el('scrim').classList.add('hidden')}

  function registerPwa(){
    if('serviceWorker'in navigator)navigator.serviceWorker.register('service-worker.js').catch(()=>{});
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredInstall=e;el('installBtn').classList.remove('hidden')});
    window.addEventListener('appinstalled',()=>{state.deferredInstall=null;el('installBtn').classList.add('hidden');toast('SCS Workspace installed')});
  }
  async function installPwa(){if(!state.deferredInstall)return;state.deferredInstall.prompt();await state.deferredInstall.userChoice;state.deferredInstall=null;el('installBtn').classList.add('hidden')}

  function toast(message,type='success'){const node=document.createElement('div');node.className=`toast ${type==='error'?'error':''}`;node.textContent=message;el('toastRegion').append(node);setTimeout(()=>node.remove(),4200)}
  function showAuthError(message){el('authMessage').textContent=message}
  function friendlyError(error){const msg=error?.message||String(error||'Something went wrong');if(/invalid login/i.test(msg))return'Email or password is incorrect.';if(/fetch/i.test(msg))return'Could not connect. Check your internet connection.';return msg}
  function clean(v){return String(v??'').trim()}
  function urlBase64ToUint8Array(value){const padding='='.repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64);return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)))}
  function numberOrNull(v){return clean(v)===''?null:Number(v)}
  function initialsFor(v){const parts=clean(v).split(/\s+/).filter(Boolean);return((parts[0]?.[0]||'S')+(parts[1]?.[0]||parts[0]?.[1]||'C')).toUpperCase().slice(0,2)}
  function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function escapeAttr(v){return escapeHtml(v).replace(/`/g,'&#96;')}
  function capitalize(v){v=String(v||'');return v.charAt(0).toUpperCase()+v.slice(1)}
  function formatInquiryNo(n){return `INQ-${String(n).padStart(4,'0')}`}
  function formatQuantity(v){return v==null?'Quantity not set':Number(v).toLocaleString(undefined,{maximumFractionDigits:3})}
  function formatMoney(v,c){return v==null?'Not added':`${c||''} ${Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`.trim()}
  function taskStatusLabel(v){return({todo:'To do',in_progress:'In progress',done:'Completed'})[v]||capitalize(v)}
  function formatBytes(v){const n=Number(v||0);if(n<1024)return`${n} B`;if(n<1048576)return`${(n/1024).toFixed(1)} KB`;return`${(n/1048576).toFixed(1)} MB`}
  function formatDate(v){return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(v))}
  function formatDateTime(v){return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(v))}
  function relativeTime(v){const diff=new Date(v)-new Date(),abs=Math.abs(diff);let unit='minute',amount=Math.round(diff/60000);if(abs>=86400000){unit='day';amount=Math.round(diff/86400000)}else if(abs>=3600000){unit='hour';amount=Math.round(diff/3600000)}if(Math.abs(amount)<1)return'just now';return new Intl.RelativeTimeFormat(undefined,{numeric:'auto'}).format(amount,unit)}
})();
