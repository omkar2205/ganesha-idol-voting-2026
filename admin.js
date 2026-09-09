const SUPABASE_URL = 'https://agcmyvzfjersvwoqwkkc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_d8fd_YY_Aewl3wyp7pE-Qg_prvNRYvv';
const ALLOWED_DOMAIN = '@guseducationindia.com';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const els = {
  loginPanel: document.getElementById('loginPanel'),
  dashboardPanel: document.getElementById('dashboardPanel'),
  loginForm: document.getElementById('loginForm'),
  adminEmail: document.getElementById('adminEmail'),
  adminPassword: document.getElementById('adminPassword'),
  loginButton: document.getElementById('loginButton'),
  loginMessage: document.getElementById('loginMessage'),
  adminIdentity: document.getElementById('adminIdentity'),
  refreshButton: document.getElementById('refreshButton'),
  logoutButton: document.getElementById('logoutButton'),
  summaryTotal: document.getElementById('summaryTotal'),
  summaryStatus: document.getElementById('summaryStatus'),
  summaryStatusNote: document.getElementById('summaryStatusNote'),
  summaryTimer: document.getElementById('summaryTimer'),
  summaryTimerNote: document.getElementById('summaryTimerNote'),
  summaryWindow: document.getElementById('summaryWindow'),
  openVotingButton: document.getElementById('openVotingButton'),
  closeVotingButton: document.getElementById('closeVotingButton'),
  resetTimerButton: document.getElementById('resetTimerButton'),
  resetVotesButton: document.getElementById('resetVotesButton'),
  timerForm: document.getElementById('timerForm'),
  timerMinutes: document.getElementById('timerMinutes'),
  resultsGrid: document.getElementById('resultsGrid'),
  votesTableBody: document.getElementById('votesTableBody'),
  emptyVotes: document.getElementById('emptyVotes'),
  toast: document.getElementById('toast'),
};

let dashboardRefresh = null;
let busy = false;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isAllowedEmail(value) {
  const email = normalizeEmail(value);
  if (!email.endsWith(ALLOWED_DOMAIN)) return false;
  if (email.length <= ALLOWED_DOMAIN.length) return false;
  if (/\s/.test(email)) return false;
  return (email.match(/@/g) || []).length === 1;
}

function setLoginMessage(kind, message) {
  els.loginMessage.className = `form-message${kind ? ` ${kind}` : ''}`;
  els.loginMessage.textContent = message || '';
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2600);
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll('button, input').forEach((control) => {
    if (control.closest('#dashboardPanel') || control.closest('#loginPanel')) {
      control.disabled = busy;
    }
  });
}

function formatDateTime(value) {
  if (!value) return 'Not started';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not started';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimer(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
}

function remainingSeconds(settings, serverNow) {
  if (!settings?.results_reveal_at) return null;
  const reveal = new Date(settings.results_reveal_at).getTime();
  const now = new Date(serverNow || Date.now()).getTime();
  if (!Number.isFinite(reveal) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.ceil((reveal - now) / 1000));
}

function percentage(votes, total) {
  if (!total) return 0;
  return Math.round((Number(votes || 0) / total) * 100);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showDashboard() {
  els.loginPanel.hidden = true;
  els.dashboardPanel.hidden = false;
}

function showLogin() {
  els.dashboardPanel.hidden = true;
  els.loginPanel.hidden = false;
}

function renderDashboard(payload) {
  const settings = payload?.settings || {};
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const votes = Array.isArray(payload?.votes) ? payload.votes : [];
  const totalVotes = Number(payload?.total_votes || 0);
  const windowSeconds = Number(settings.voting_window_seconds || 60);
  const remaining = remainingSeconds(settings, payload?.server_now);
  const timerStarted = Boolean(settings.first_vote_at && settings.results_reveal_at);
  const ended = timerStarted && remaining === 0;
  const votingOpen = Boolean(settings.voting_open) && !ended;

  els.adminIdentity.textContent = payload?.admin_email ? `Signed in as ${payload.admin_email}` : 'Signed in';
  els.summaryTotal.textContent = totalVotes.toLocaleString();
  els.summaryStatus.textContent = votingOpen ? 'Open' : 'Closed';
  els.summaryStatusNote.textContent = ended ? 'Timer finished' : votingOpen ? 'Accepting votes' : 'Not accepting votes';
  els.summaryTimer.textContent = !timerStarted ? 'Waiting' : ended ? 'Ended' : formatTimer(remaining);
  els.summaryTimerNote.textContent = !timerStarted
    ? 'Starts with first vote'
    : `Started ${formatDateTime(settings.first_vote_at)}`;
  els.summaryWindow.textContent = `${Math.round(windowSeconds / 60)} min`;
  els.timerMinutes.value = Math.max(1, Math.round(windowSeconds / 60));

  els.resultsGrid.innerHTML = results.map((item) => {
    const count = Number(item.vote_count || 0);
    const pct = percentage(count, totalVotes);
    return `
      <div class="result-row">
        <div>
          <div class="result-name">${escapeHtml(item.title || `Team ${item.sort_order}`)}</div>
          <div class="result-percent">${pct}% of total</div>
        </div>
        <div class="result-count">${count.toLocaleString()}</div>
        <div class="result-bar" aria-hidden="true"><span class="result-fill" style="width:${pct}%"></span></div>
      </div>
    `;
  }).join('');

  els.emptyVotes.hidden = votes.length > 0;
  els.votesTableBody.innerHTML = votes.map((vote) => `
    <tr>
      <td class="email-cell">${escapeHtml(vote.voter_email)}</td>
      <td>${escapeHtml(vote.entry_title || `Team ${vote.entry_id}`)}</td>
      <td>${escapeHtml(formatDateTime(vote.created_at))}</td>
      <td><button class="remove-button" type="button" data-vote-id="${vote.id}" data-email="${escapeHtml(vote.voter_email)}">Remove</button></td>
    </tr>
  `).join('');

  els.votesTableBody.querySelectorAll('[data-vote-id]').forEach((button) => {
    button.addEventListener('click', () => removeVote(button.dataset.voteId, button.dataset.email));
  });
}

async function loadDashboard() {
  const { data, error } = await supabaseClient.rpc('admin_get_dashboard');
  if (error) throw error;
  renderDashboard(data);
  showDashboard();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = normalizeEmail(els.adminEmail.value);
  const password = String(els.adminPassword.value || '');

  if (!isAllowedEmail(email)) {
    setLoginMessage('error', 'Use a valid @guseducationindia.com admin email.');
    return;
  }

  if (!password) {
    setLoginMessage('error', 'Enter the admin password.');
    return;
  }

  setBusy(true);
  setLoginMessage('', '');

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await loadDashboard();
    showToast('Admin dashboard loaded.');
  } catch (error) {
    console.error(error);
    setLoginMessage('error', error?.message || 'Could not log in.');
  } finally {
    setBusy(false);
  }
}

async function performAction(label, callback) {
  if (busy) return;
  setBusy(true);

  try {
    const data = await callback();
    if (data) renderDashboard(data);
    else await loadDashboard();
    showToast(label);
  } catch (error) {
    console.error(error);
    showToast(error?.message || 'Admin action failed.');
    if (String(error?.message || '').toLowerCase().includes('admin access')) {
      await supabaseClient.auth.signOut();
      showLogin();
    }
  } finally {
    setBusy(false);
  }
}

async function updateSettings(args) {
  const { data, error } = await supabaseClient.rpc('admin_update_settings', args);
  if (error) throw error;
  return data;
}

function openVoting() {
  performAction('Voting opened.', () => updateSettings({
    p_voting_open: true,
    p_voting_window_seconds: null,
    p_reset_timer: false,
  }));
}

function closeVoting() {
  performAction('Voting closed.', () => updateSettings({
    p_voting_open: false,
    p_voting_window_seconds: null,
    p_reset_timer: false,
  }));
}

function resetTimer() {
  const confirmed = window.confirm('Reset the countdown to Waiting? Existing votes will remain, but the first new vote after reset will start the timer again.');
  if (!confirmed) return;

  performAction('Timer reset.', () => updateSettings({
    p_voting_open: true,
    p_voting_window_seconds: null,
    p_reset_timer: true,
  }));
}

function resetVotes() {
  const confirmed = window.confirm('Reset all votes? This will remove every voter record and set the timer back to Waiting.');
  if (!confirmed) return;

  performAction('All votes reset.', async () => {
    const { data, error } = await supabaseClient.rpc('admin_reset_votes');
    if (error) throw error;
    return data;
  });
}

function saveTimer(event) {
  event.preventDefault();
  const minutes = Number(els.timerMinutes.value || 0);

  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    showToast('Timer must be between 1 and 1440 minutes.');
    return;
  }

  performAction('Timer saved.', () => updateSettings({
    p_voting_open: null,
    p_voting_window_seconds: Math.round(minutes * 60),
    p_reset_timer: false,
  }));
}

function removeVote(voteId, email) {
  const confirmed = window.confirm(`Remove the vote from ${email}?`);
  if (!confirmed) return;

  performAction('Vote removed.', async () => {
    const { data, error } = await supabaseClient.rpc('admin_delete_vote', {
      p_vote_id: Number(voteId),
    });
    if (error) throw error;
    return data;
  });
}

async function logout() {
  await supabaseClient.auth.signOut();
  showLogin();
  showToast('Logged out.');
}

async function init() {
  const { data } = await supabaseClient.auth.getSession();
  if (data?.session) {
    try {
      await loadDashboard();
    } catch (error) {
      console.error(error);
      await supabaseClient.auth.signOut();
      showLogin();
      setLoginMessage('error', 'This account does not have admin access yet.');
    }
  } else {
    showLogin();
  }

  dashboardRefresh = window.setInterval(() => {
    if (!els.dashboardPanel.hidden && !busy) {
      loadDashboard().catch((error) => console.error('Admin refresh failed:', error));
    }
  }, 5000);
}

els.loginForm.addEventListener('submit', handleLogin);
els.refreshButton.addEventListener('click', () => performAction('Dashboard refreshed.', loadDashboard));
els.logoutButton.addEventListener('click', logout);
els.openVotingButton.addEventListener('click', openVoting);
els.closeVotingButton.addEventListener('click', closeVoting);
els.resetTimerButton.addEventListener('click', resetTimer);
els.resetVotesButton.addEventListener('click', resetVotes);
els.timerForm.addEventListener('submit', saveTimer);

window.addEventListener('pagehide', () => {
  if (dashboardRefresh) window.clearInterval(dashboardRefresh);
});

init();