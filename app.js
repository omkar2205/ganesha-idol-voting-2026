const SUPABASE_URL = 'https://agcmyvzfjersvwoqwkkc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_d8fd_YY_Aewl3wyp7pE-Qg_prvNRYvv';
const ALLOWED_DOMAIN = '@guseducationindia.com';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  settings: null,
  entries: [],
  images: [],
  voterEmail: '',
  gatePassed: false,
  emailReady: false,
  alreadyVoted: false,
  myVote: null,
  publicStatus: null,
  results: new Map(),
  serverOffsetMs: 0,
  busy: false,
};

const els = {
  statusText: document.getElementById('statusText'),
  totalVotes: document.getElementById('totalVotes'),
  countdown: document.getElementById('countdown'),
  countdownLabel: document.getElementById('countdownLabel'),
  countdownNote: document.getElementById('countdownNote'),
  entriesGrid: document.getElementById('entriesGrid'),
  emptyState: document.getElementById('emptyState'),
  emailOverlay: document.getElementById('emailOverlay'),
  emailForm: document.getElementById('emailForm'),
  emailInput: document.getElementById('emailInput'),
  emailButton: document.getElementById('emailButton'),
  emailMessage: document.getElementById('emailMessage'),
  imageDialog: document.getElementById('imageDialog'),
  dialogImage: document.getElementById('dialogImage'),
  dialogCaption: document.getElementById('dialogCaption'),
  closeDialog: document.getElementById('closeDialog'),
  toast: document.getElementById('toast'),
};

let statusPollTimer = null;
let countdownTimer = null;
let expiryRefreshPending = false;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isAllowedEmail(value) {
  const email = normalizeEmail(value);
  return email.length > ALLOWED_DOMAIN.length
    && email.endsWith(ALLOWED_DOMAIN)
    && !/\s/.test(email)
    && (email.match(/@/g) || []).length === 1;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove('show'), 2800);
}

function setEmailMessage(kind, message) {
  els.emailMessage.className = `email-message${kind ? ` ${kind}` : ''}`;
  els.emailMessage.textContent = message || '';
}

function naturalSort(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function serverNowMs() {
  return Date.now() + state.serverOffsetMs;
}

function revealTimeMs() {
  const raw = state.publicStatus?.results_reveal_at;
  if (!raw) return null;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : null;
}

function remainingMs() {
  const reveal = revealTimeMs();
  return reveal === null ? null : Math.max(0, reveal - serverNowMs());
}

function resultsAvailable() {
  if (state.publicStatus?.results_available) return true;
  const remaining = remainingMs();
  return remaining !== null && remaining <= 0;
}

function votingIsOpen() {
  if (!state.publicStatus?.voting_open) return false;
  const remaining = remainingMs();
  return remaining === null || remaining > 0;
}

function formatCountdown(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function closeEmailGate() {
  state.gatePassed = true;
  document.body.classList.remove('gate-open');
  els.emailOverlay.hidden = true;
}

async function loadSettingsAndEntries() {
  const [settingsResponse, entriesResponse] = await Promise.all([
    supabaseClient
      .from('vote_settings')
      .select('event_title,event_subtitle,event_date,image_feed_url,drive_folder_id')
      .eq('id', true)
      .single(),
    supabaseClient
      .from('entries')
      .select('id,slug,title,sort_order,active')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
  ]);

  if (settingsResponse.error) throw settingsResponse.error;
  if (entriesResponse.error) throw entriesResponse.error;

  state.settings = settingsResponse.data;
  state.entries = entriesResponse.data || [];
}

async function loadDriveImages() {
  const feedUrl = state.settings?.image_feed_url;
  if (!feedUrl) {
    state.images = [];
    return;
  }

  const separator = feedUrl.includes('?') ? '&' : '?';
  const response = await fetch(`${feedUrl}${separator}v=${Date.now()}`, {
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Could not load the competition photographs.');

  const payload = await response.json();
  const files = Array.isArray(payload) ? payload : payload.files;
  state.images = (Array.isArray(files) ? files : [])
    .filter((file) => file?.id && file?.imageUrl)
    .sort(naturalSort)
    .slice(0, 4);
}

async function checkEmailAlreadyVoted(email) {
  const { data, error } = await supabaseClient.rpc('has_email_voted', {
    p_voter_email: email,
  });
  if (error) throw error;
  return Boolean(data);
}

async function loadPublicStatus() {
  const previousResults = resultsAvailable();
  const { data, error } = await supabaseClient.rpc('get_public_vote_status');
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Voting status is unavailable.');

  const serverTime = new Date(row.server_now).getTime();
  if (Number.isFinite(serverTime)) state.serverOffsetMs = serverTime - Date.now();

  state.publicStatus = row;
  expiryRefreshPending = false;
  updateLiveDisplay();

  if (!previousResults && resultsAvailable()) await loadResults();
}

function updateLiveDisplay() {
  const total = Number(state.publicStatus?.total_votes || 0);
  els.totalVotes.textContent = Number.isFinite(total) ? total.toLocaleString() : '0';

  if (!state.publicStatus) {
    els.statusText.textContent = 'Preparing the competition…';
    els.countdown.textContent = 'Waiting';
    return;
  }

  if (resultsAvailable()) {
    els.statusText.textContent = 'Voting complete';
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00';
    els.countdownNote.textContent = 'Results are final';
    return;
  }

  if (!state.publicStatus.first_vote_at || !state.publicStatus.results_reveal_at) {
    els.statusText.textContent = votingIsOpen() ? 'Voting is open' : 'Voting is closed';
    els.countdownLabel.textContent = 'Countdown';
    els.countdown.textContent = 'Waiting';
    els.countdownNote.textContent = 'Starts with the first vote';
    return;
  }

  const remaining = remainingMs();
  if (remaining !== null && remaining > 0) {
    els.statusText.textContent = 'Voting is open';
    els.countdownLabel.textContent = 'Closes in';
    els.countdown.textContent = formatCountdown(remaining);
    els.countdownNote.textContent = 'Totals reveal at zero';
  } else {
    els.statusText.textContent = 'Voting complete';
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00';
    els.countdownNote.textContent = 'Preparing results';
  }
}

function resultForEntry(entryId) {
  return state.results.get(Number(entryId)) || null;
}

function renderEntries() {
  els.entriesGrid.innerHTML = '';

  if (!state.images.length) {
    els.emptyState.hidden = false;
    return;
  }

  els.emptyState.hidden = true;
  const visibleEntries = state.entries.slice(0, state.images.length);
  const canVote = state.gatePassed && votingIsOpen() && state.emailReady && !state.alreadyVoted && !state.busy;
  const showResults = resultsAvailable() && state.results.size > 0;

  visibleEntries.forEach((entry, index) => {
    const image = state.images[index];
    if (!image) return;

    const selected = state.myVote === Number(entry.id);
    const result = resultForEntry(entry.id);

    let buttonText = 'Vote';
    let detailText = 'Tap the photograph to view larger';

    if (!state.gatePassed) buttonText = 'Enter email to vote';
    else if (!votingIsOpen()) buttonText = 'Voting closed';
    else if (selected) {
      buttonText = 'Vote cast';
      detailText = 'Your vote is locked';
    } else if (state.alreadyVoted) {
      buttonText = 'Vote locked';
      detailText = 'This email has already voted';
    } else if (!state.emailReady) {
      buttonText = 'Vote unavailable';
    }

    const article = document.createElement('article');
    article.className = `entry-card${selected ? ' selected' : ''}`;
    article.innerHTML = `
      <div class="entry-media" role="button" tabindex="0" aria-label="View ${escapeHtml(entry.title)} image">
        <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(entry.title)} Ganesha idol" loading="lazy" decoding="async" />
        <span class="entry-number">${String(entry.sort_order).padStart(2, '0')}</span>
      </div>
      <div class="entry-footer">
        <div>
          <h3 class="entry-title">${escapeHtml(entry.title)}</h3>
          <p class="entry-detail">${detailText}</p>
        </div>
        <button class="vote-button" type="button" ${canVote ? '' : 'disabled'}>${buttonText}</button>
      </div>
      ${showResults && result ? `
        <div class="entry-final">
          <span>Final result</span>
          <strong>${Number(result.vote_count).toLocaleString()} votes · ${result.percentage}%</strong>
        </div>
      ` : ''}
    `;

    const media = article.querySelector('.entry-media');
    const voteButton = article.querySelector('.vote-button');
    const openImage = () => showImage(image.imageUrl, entry.title);

    media.addEventListener('click', openImage);
    media.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openImage();
      }
    });
    voteButton.addEventListener('click', () => castVote(Number(entry.id)));
    els.entriesGrid.appendChild(article);
  });
}

function showImage(src, caption) {
  els.dialogImage.src = src;
  els.dialogImage.alt = `${caption} Ganesha idol`;
  els.dialogCaption.textContent = caption;
  if (typeof els.imageDialog.showModal === 'function') els.imageDialog.showModal();
  else els.imageDialog.setAttribute('open', '');
}

function closeImage() {
  if (typeof els.imageDialog.close === 'function') els.imageDialog.close();
  else els.imageDialog.removeAttribute('open');
}

async function handleEmailSubmit(event) {
  event.preventDefault();
  if (state.busy) return;

  const email = normalizeEmail(els.emailInput.value);
  if (!isAllowedEmail(email)) {
    setEmailMessage('error', 'Please enter a valid @guseducationindia.com email address.');
    return;
  }

  state.busy = true;
  els.emailInput.disabled = true;
  els.emailButton.disabled = true;
  setEmailMessage('', '');

  try {
    state.voterEmail = email;

    if (resultsAvailable() || !votingIsOpen()) {
      state.emailReady = false;
      state.alreadyVoted = false;
      closeEmailGate();
      renderEntries();
      return;
    }

    state.alreadyVoted = await checkEmailAlreadyVoted(email);
    state.emailReady = !state.alreadyVoted;
    closeEmailGate();
    renderEntries();

    if (state.alreadyVoted) {
      showToast('This email has already voted. You can view the competition, but cannot vote again.');
    }
  } catch (error) {
    console.error(error);
    state.voterEmail = '';
    setEmailMessage('error', error?.message || 'Could not check this email. Please try again.');
  } finally {
    state.busy = false;
    els.emailInput.disabled = false;
    els.emailButton.disabled = false;
  }
}

async function castVote(entryId) {
  if (state.busy || !state.emailReady || state.alreadyVoted || !votingIsOpen()) return;

  const entry = state.entries.find((item) => Number(item.id) === Number(entryId));
  const name = entry?.title || 'this entry';
  const confirmed = window.confirm(`Confirm your vote for ${name}? Once submitted, your vote cannot be changed.`);
  if (!confirmed) return;

  state.busy = true;
  renderEntries();

  try {
    const { error } = await supabaseClient.rpc('cast_vote', {
      p_entry_id: entryId,
      p_voter_email: state.voterEmail,
    });
    if (error) throw error;

    state.myVote = entryId;
    state.alreadyVoted = true;
    state.emailReady = false;
    showToast('Your vote has been recorded.');
    await loadPublicStatus();
  } catch (error) {
    console.error(error);
    const message = String(error?.message || 'Your vote could not be recorded. Please try again.');
    if (message.toLowerCase().includes('already voted')) {
      state.alreadyVoted = true;
      state.emailReady = false;
    }
    showToast(message);
    await loadPublicStatus().catch(() => {});
  } finally {
    state.busy = false;
    renderEntries();
  }
}

async function loadResults() {
  if (!resultsAvailable()) {
    state.results.clear();
    renderEntries();
    return;
  }

  const { data, error } = await supabaseClient.rpc('get_vote_results');
  if (error) {
    console.error('Could not load final results:', error);
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  const total = rows.reduce((sum, row) => sum + Number(row.vote_count || 0), 0);
  state.results.clear();

  rows.forEach((row) => {
    const votes = Number(row.vote_count || 0);
    state.results.set(Number(row.entry_id), {
      ...row,
      percentage: total ? Math.round((votes / total) * 100) : 0,
    });
  });

  renderEntries();
}

function tickCountdown() {
  updateLiveDisplay();

  if (state.publicStatus?.results_reveal_at && remainingMs() === 0 && !state.publicStatus.results_available && !expiryRefreshPending) {
    expiryRefreshPending = true;
    loadPublicStatus()
      .then(() => loadResults())
      .catch((error) => {
        expiryRefreshPending = false;
        console.error('Could not refresh final voting status:', error);
      });
  }
}

async function refreshStatusQuietly() {
  try {
    await loadPublicStatus();
    if (resultsAvailable()) await loadResults();
    else renderEntries();
  } catch (error) {
    console.error('Could not refresh voting status:', error);
  }
}

async function init() {
  try {
    await loadSettingsAndEntries();
    await Promise.all([loadDriveImages(), loadPublicStatus()]);
    renderEntries();
    if (resultsAvailable()) await loadResults();

    countdownTimer = window.setInterval(tickCountdown, 1000);
    statusPollTimer = window.setInterval(refreshStatusQuietly, 4000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshStatusQuietly();
    });
  } catch (error) {
    console.error(error);
    els.statusText.textContent = 'Voting page is temporarily unavailable';
    els.emptyState.hidden = false;
    setEmailMessage('error', 'The voting page could not be loaded. Please refresh and try again.');
  }
}

els.emailForm.addEventListener('submit', handleEmailSubmit);
els.closeDialog.addEventListener('click', closeImage);
els.imageDialog.addEventListener('click', (event) => {
  if (event.target === els.imageDialog) closeImage();
});

window.addEventListener('pagehide', () => {
  if (statusPollTimer) window.clearInterval(statusPollTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
});

init();
