const SUPABASE_URL = 'https://agcmyvzfjersvwoqwkkc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_d8fd_YY_Aewl3wyp7pE-Qg_prvNRYvv';
const ALLOWED_DOMAIN = '@guseducationindia.com';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  settings: null,
  entries: [],
  images: [],
  voterEmail: '',
  emailReady: false,
  alreadyVoted: false,
  myVote: null,
  publicStatus: null,
  serverOffsetMs: 0,
  busy: false,
};

const els = {
  statusBanner: document.getElementById('statusBanner'),
  statusText: document.getElementById('statusText'),
  totalVotes: document.getElementById('totalVotes'),
  countdown: document.getElementById('countdown'),
  countdownLabel: document.getElementById('countdownLabel'),
  countdownNote: document.getElementById('countdownNote'),
  emailForm: document.getElementById('emailForm'),
  emailInput: document.getElementById('emailInput'),
  emailButton: document.getElementById('emailButton'),
  emailMessage: document.getElementById('emailMessage'),
  entriesGrid: document.getElementById('entriesGrid'),
  emptyState: document.getElementById('emptyState'),
  resultsSection: document.getElementById('resultsSection'),
  resultsList: document.getElementById('resultsList'),
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
  if (!email.endsWith(ALLOWED_DOMAIN)) return false;
  if (email.length <= ALLOWED_DOMAIN.length) return false;
  if (/\s/.test(email)) return false;
  return (email.match(/@/g) || []).length === 1;
}

function setEmailMessage(kind, message) {
  els.emailMessage.className = `email-message${kind ? ` ${kind}` : ''}`;
  els.emailMessage.textContent = message || '';
}

function setStatus(kind, message) {
  els.statusBanner.className = `status-banner ${kind}`;
  els.statusText.textContent = message;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2600);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  const value = state.publicStatus?.results_reveal_at;
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function remainingMs() {
  const reveal = revealTimeMs();
  if (reveal === null) return null;
  return Math.max(0, reveal - serverNowMs());
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
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function updateEmailControls() {
  const enabled = votingIsOpen() && !resultsAvailable();
  els.emailInput.disabled = !enabled || state.busy;
  els.emailButton.disabled = !enabled || state.busy;
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
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Could not load the finalist photographs.');
  }

  const payload = await response.json();
  const files = Array.isArray(payload) ? payload : payload.files;

  state.images = (Array.isArray(files) ? files : [])
    .filter((file) => file && file.id && file.imageUrl)
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
  const previousOpen = votingIsOpen();
  const previousResults = resultsAvailable();

  const { data, error } = await supabaseClient.rpc('get_public_vote_status');
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Voting status is unavailable.');

  const serverTime = new Date(row.server_now).getTime();
  if (Number.isFinite(serverTime)) {
    state.serverOffsetMs = serverTime - Date.now();
  }

  state.publicStatus = row;
  expiryRefreshPending = false;
  updateLivePanel();
  updateEmailControls();

  const currentOpen = votingIsOpen();
  const currentResults = resultsAvailable();
  if (previousOpen !== currentOpen) renderEntries();
  if (!previousResults && currentResults) await loadResults();
}

function updateLivePanel() {
  const total = Number(state.publicStatus?.total_votes || 0);
  els.totalVotes.textContent = Number.isFinite(total) ? total.toLocaleString() : '0';

  if (!state.publicStatus) {
    els.countdown.textContent = 'Waiting';
    return;
  }

  if (resultsAvailable()) {
    setStatus('closed', 'Voting has ended');
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00:00';
    els.countdownNote.textContent = 'Final results are now available below';
    return;
  }

  if (!state.publicStatus.first_vote_at || !state.publicStatus.results_reveal_at) {
    setStatus(votingIsOpen() ? 'open' : 'closed', votingIsOpen() ? 'Voting is open' : 'Voting is closed');
    els.countdownLabel.textContent = 'Countdown';
    els.countdown.textContent = 'Waiting';
    els.countdownNote.textContent = 'The 1-hour voting window starts with the first vote';
    return;
  }

  const remaining = remainingMs();
  if (remaining !== null && remaining > 0) {
    setStatus(votingIsOpen() ? 'open' : 'closed', votingIsOpen() ? 'Voting is open' : 'Voting is closed');
    els.countdownLabel.textContent = 'Voting closes in';
    els.countdown.textContent = formatCountdown(remaining);
    els.countdownNote.textContent = 'Individual vote totals stay hidden until the countdown ends';
  } else {
    setStatus('closed', 'Voting has ended');
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00:00';
    els.countdownNote.textContent = 'Preparing final results…';
  }
}

function tickCountdown() {
  const wasOpen = votingIsOpen();
  updateLivePanel();
  updateEmailControls();
  const isOpen = votingIsOpen();

  if (wasOpen !== isOpen) renderEntries();

  if (state.publicStatus?.results_reveal_at && remainingMs() === 0 && !state.publicStatus.results_available && !expiryRefreshPending) {
    expiryRefreshPending = true;
    loadPublicStatus().catch((error) => {
      expiryRefreshPending = false;
      console.error('Could not refresh final voting status:', error);
    });
  }
}

function getImageForEntry(index) {
  return state.images[index] || null;
}

function renderEntries() {
  els.entriesGrid.innerHTML = '';

  if (!state.images.length) {
    els.emptyState.hidden = false;
    return;
  }

  els.emptyState.hidden = true;
  const visibleEntries = state.entries.slice(0, state.images.length);
  const votingOpen = votingIsOpen();
  const canVote = votingOpen && state.emailReady && !state.alreadyVoted && !state.busy;

  visibleEntries.forEach((entry, index) => {
    const image = getImageForEntry(index);
    if (!image) return;

    const selected = state.myVote === Number(entry.id);
    const article = document.createElement('article');
    article.className = `entry-card${selected ? ' selected' : ''}`;
    article.dataset.entryId = entry.id;

    let buttonText = 'Enter email to vote';
    if (!votingOpen) buttonText = 'Voting closed';
    else if (selected) buttonText = 'Vote cast';
    else if (state.alreadyVoted) buttonText = 'Vote locked';
    else if (state.emailReady) buttonText = 'Vote';

    let detailText = 'Tap the image to view larger';
    if (selected) detailText = 'Your vote is locked';
    else if (state.alreadyVoted) detailText = 'This email has already voted';

    article.innerHTML = `
      <div class="entry-media" role="button" tabindex="0" aria-label="View ${escapeHtml(entry.title)} image">
        <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(entry.title)} Ganesha idol" loading="lazy" decoding="async" />
        <span class="entry-number">${String(entry.sort_order).padStart(2, '0')}</span>
      </div>
      <div class="entry-body">
        <div class="entry-copy">
          <h3>${escapeHtml(entry.title)}</h3>
          <p>${detailText}</p>
        </div>
        <button class="vote-button" type="button" ${canVote ? '' : 'disabled'}>
          ${buttonText}
        </button>
      </div>
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

  if (typeof els.imageDialog.showModal === 'function') {
    els.imageDialog.showModal();
  } else {
    els.imageDialog.setAttribute('open', '');
  }
}

function closeImage() {
  if (typeof els.imageDialog.close === 'function') {
    els.imageDialog.close();
  } else {
    els.imageDialog.removeAttribute('open');
  }
}

async function handleEmailSubmit(event) {
  event.preventDefault();

  if (!votingIsOpen()) {
    setEmailMessage('error', 'Voting is closed.');
    return;
  }

  const email = normalizeEmail(els.emailInput.value);
  if (!isAllowedEmail(email)) {
    state.voterEmail = '';
    state.emailReady = false;
    state.alreadyVoted = false;
    state.myVote = null;
    setEmailMessage('error', 'Please enter a valid @guseducationindia.com email address.');
    renderEntries();
    return;
  }

  state.busy = true;
  state.voterEmail = email;
  state.emailReady = false;
  state.alreadyVoted = false;
  state.myVote = null;
  updateEmailControls();
  renderEntries();

  try {
    const alreadyVoted = await checkEmailAlreadyVoted(email);
    state.alreadyVoted = alreadyVoted;
    state.emailReady = !alreadyVoted;

    if (alreadyVoted) {
      setEmailMessage('error', 'This email address has already voted.');
    } else {
      setEmailMessage('success', 'Email accepted. Pick your favourite below.');
    }
  } catch (error) {
    console.error(error);
    state.voterEmail = '';
    state.emailReady = false;
    state.alreadyVoted = false;
    setEmailMessage('error', error?.message || 'Could not check this email. Please try again.');
  } finally {
    state.busy = false;
    updateEmailControls();
    renderEntries();
  }
}

function handleEmailInput() {
  const current = normalizeEmail(els.emailInput.value);
  if (current === state.voterEmail) return;

  state.voterEmail = '';
  state.emailReady = false;
  state.alreadyVoted = false;
  state.myVote = null;
  setEmailMessage('', '');
  renderEntries();
}

async function castVote(entryId) {
  if (state.busy || !votingIsOpen()) return;

  if (!state.voterEmail || !state.emailReady) {
    showToast('Enter your work email and press Continue first.');
    return;
  }

  if (state.alreadyVoted) {
    showToast('This email address has already voted.');
    return;
  }

  const entry = state.entries.find((item) => Number(item.id) === Number(entryId));
  const entryName = entry?.title || 'this entry';
  const confirmed = window.confirm(`Confirm your vote for ${entryName}? Once submitted, your vote cannot be changed.`);
  if (!confirmed) return;

  state.busy = true;
  updateEmailControls();
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
    setEmailMessage('success', 'Vote recorded. This email cannot vote again.');
    showToast('Your vote has been recorded and locked.');

    await loadPublicStatus();
  } catch (error) {
    console.error(error);

    if (String(error?.message || '').toLowerCase().includes('already voted')) {
      state.alreadyVoted = true;
      state.emailReady = false;
      setEmailMessage('error', 'This email address has already voted.');
    }

    showToast(error?.message || 'Your vote could not be recorded. Please try again.');
    await loadPublicStatus().catch(() => {});
  } finally {
    state.busy = false;
    updateEmailControls();
    renderEntries();
  }
}

async function loadResults() {
  if (!resultsAvailable()) {
    els.resultsSection.hidden = true;
    return;
  }

  const { data, error } = await supabaseClient.rpc('get_vote_results');
  if (error) {
    console.error('Could not load final results:', error);
    els.resultsSection.hidden = true;
    return;
  }

  const results = Array.isArray(data) ? data : [];
  const total = results.reduce((sum, item) => sum + Number(item.vote_count || 0), 0);
  const highest = Math.max(...results.map((item) => Number(item.vote_count || 0)), 1);

  els.resultsList.innerHTML = results.map((item) => {
    const votes = Number(item.vote_count || 0);
    const width = Math.max(0, Math.min(100, (votes / highest) * 100));
    const percentage = total ? Math.round((votes / total) * 100) : 0;

    return `
      <div class="result-row">
        <span class="result-name">${escapeHtml(item.title)}</span>
        <div class="result-track" aria-hidden="true"><div class="result-fill" style="width:${width}%"></div></div>
        <span class="result-count">${votes} · ${percentage}%</span>
      </div>
    `;
  }).join('');

  els.resultsSection.hidden = false;
}

async function refreshStatusQuietly() {
  try {
    await loadPublicStatus();
    if (resultsAvailable()) await loadResults();
  } catch (error) {
    console.error('Could not refresh voting status:', error);
  }
}

async function init() {
  try {
    await loadSettingsAndEntries();
    await Promise.all([
      loadDriveImages(),
      loadPublicStatus(),
    ]);

    renderEntries();
    await loadResults();
    updateEmailControls();

    countdownTimer = window.setInterval(tickCountdown, 1000);
    statusPollTimer = window.setInterval(refreshStatusQuietly, 5000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshStatusQuietly();
    });
  } catch (error) {
    console.error(error);
    setStatus('closed', 'Voting page is temporarily unavailable');
    els.emptyState.hidden = false;
    updateEmailControls();
  }
}

els.emailForm.addEventListener('submit', handleEmailSubmit);
els.emailInput.addEventListener('input', handleEmailInput);
els.closeDialog.addEventListener('click', closeImage);
els.imageDialog.addEventListener('click', (event) => {
  if (event.target === els.imageDialog) closeImage();
});

window.addEventListener('pagehide', () => {
  if (statusPollTimer) window.clearInterval(statusPollTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
});

init();
