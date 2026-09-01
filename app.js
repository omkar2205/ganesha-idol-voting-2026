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
  results: {},
  resultsLoaded: false,
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
  emailOverlay: document.getElementById('emailOverlay'),
  emailForm: document.getElementById('emailForm'),
  emailInput: document.getElementById('emailInput'),
  emailButton: document.getElementById('emailButton'),
  emailMessage: document.getElementById('emailMessage'),
  entriesGrid: document.getElementById('entriesGrid'),
  emptyState: document.getElementById('emptyState'),
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
  }, 2800);
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
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function formatVotingWindow() {
  const seconds = Number(state.settings?.voting_window_seconds || 60);
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours}-hour`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes}-minute`;
  }
  return `${seconds}-second`;
}

function updateEmailControls() {
  els.emailInput.disabled = state.busy;
  els.emailButton.disabled = state.busy;
}

function unlockSite() {
  document.body.classList.remove('gate-open');
  els.emailOverlay.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    const heading = document.querySelector('.hero h1');
    if (heading) heading.setAttribute('tabindex', '-1');
  }, 0);
}

async function loadSettingsAndEntries() {
  const [settingsResponse, entriesResponse] = await Promise.all([
    supabaseClient
      .from('vote_settings')
      .select('event_title,event_subtitle,event_date,image_feed_url,drive_folder_id,voting_window_seconds')
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
    throw new Error('Could not load the competition photographs.');
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

  const currentOpen = votingIsOpen();
  const currentResults = resultsAvailable();

  if (currentResults && (!state.resultsLoaded || !previousResults)) {
    await loadResults();
  } else if (previousOpen !== currentOpen) {
    renderEntries();
  }
}

function updateLivePanel() {
  const total = Number(state.publicStatus?.total_votes || 0);
  els.totalVotes.textContent = Number.isFinite(total) ? total.toLocaleString() : '0';

  if (!state.publicStatus) {
    els.countdownLabel.textContent = 'Countdown';
    els.countdown.textContent = 'Waiting';
    els.countdownNote.textContent = 'Starts with the first vote';
    return;
  }

  if (resultsAvailable()) {
    setStatus('closed', 'Voting has ended');
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00:00';
    els.countdownNote.textContent = 'Results are now shown under each entry';
    return;
  }

  if (!state.publicStatus.first_vote_at || !state.publicStatus.results_reveal_at) {
    setStatus(votingIsOpen() ? 'open' : 'closed', votingIsOpen() ? 'Voting is open' : 'Voting is closed');
    els.countdownLabel.textContent = 'Countdown';
    els.countdown.textContent = 'Waiting';
    els.countdownNote.textContent = `${formatVotingWindow()} window starts with the first vote`;
    return;
  }

  const remaining = remainingMs();
  if (remaining !== null && remaining > 0) {
    setStatus(votingIsOpen() ? 'open' : 'closed', votingIsOpen() ? 'Voting is open' : 'Voting is closed');
    els.countdownLabel.textContent = 'Voting closes in';
    els.countdown.textContent = formatCountdown(remaining);
    els.countdownNote.textContent = 'Individual totals stay hidden until time runs out';
  } else {
    setStatus('closed', 'Voting has ended');
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00:00';
    els.countdownNote.textContent = 'Preparing results…';
  }
}

function tickCountdown() {
  const wasOpen = votingIsOpen();
  updateLivePanel();
  const isOpen = votingIsOpen();

  if (wasOpen !== isOpen) renderEntries();

  if (
    state.publicStatus?.results_reveal_at &&
    remainingMs() === 0 &&
    !state.publicStatus.results_available &&
    !expiryRefreshPending
  ) {
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

function getResultForEntry(entryId) {
  return state.results[String(entryId)] || null;
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
  const showResults = resultsAvailable() && state.resultsLoaded;

  visibleEntries.forEach((entry, index) => {
    const image = getImageForEntry(index);
    if (!image) return;

    const selected = state.myVote === Number(entry.id);
    const result = getResultForEntry(entry.id);
    const article = document.createElement('article');
    article.className = `entry-card${selected ? ' selected' : ''}`;
    article.dataset.entryId = entry.id;

    let buttonText = 'Vote';
    if (!votingOpen) buttonText = 'Voting ended';
    else if (selected) buttonText = 'Vote cast';
    else if (state.alreadyVoted) buttonText = 'Vote already cast';

    let detailText = 'Tap the image to view larger';
    if (selected) detailText = 'Your vote is locked';
    else if (state.alreadyVoted) detailText = 'This email has already voted';
    else if (!state.emailReady && votingOpen) detailText = 'Voting access unavailable';

    const resultMarkup = showResults && result
      ? `<div class="entry-result" aria-label="${escapeHtml(entry.title)} result">
          <strong>${Number(result.vote_count).toLocaleString()}</strong>
          <span>${Number(result.vote_count) === 1 ? 'vote' : 'votes'}</span>
          <span class="result-dot">•</span>
          <span class="result-percent">${result.percentage}%</span>
        </div>`
      : '';

    article.innerHTML = `
      <div class="entry-media" role="button" tabindex="0" aria-label="View ${escapeHtml(entry.title)} image">
        <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(entry.title)} Ganesha idol" loading="lazy" decoding="async" />
        <span class="entry-number">${String(entry.sort_order).padStart(2, '0')}</span>
      </div>
      ${resultMarkup}
      <div class="entry-body">
        <div class="entry-copy">
          <h2>${escapeHtml(entry.title)}</h2>
          <p>${detailText}</p>
        </div>
        <button class="vote-button" type="button" ${canVote ? '' : 'disabled'}>${buttonText}</button>
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

  const email = normalizeEmail(els.emailInput.value);
  if (!isAllowedEmail(email)) {
    setEmailMessage('error', 'Please enter a valid @guseducationindia.com email address.');
    return;
  }

  state.busy = true;
  state.voterEmail = email;
  state.emailReady = false;
  state.alreadyVoted = false;
  state.myVote = null;
  updateEmailControls();
  setEmailMessage('info', 'Checking email…');

  try {
    const alreadyVoted = await checkEmailAlreadyVoted(email);
    state.alreadyVoted = alreadyVoted;
    state.emailReady = votingIsOpen() && !alreadyVoted;

    if (alreadyVoted) {
      setEmailMessage('info', 'This email has already voted. Opening the competition…');
    } else if (votingIsOpen()) {
      setEmailMessage('success', 'Email accepted. Opening voting…');
    } else {
      setEmailMessage('success', 'Email accepted. Opening the results…');
    }

    window.setTimeout(() => {
      unlockSite();
      renderEntries();
      if (alreadyVoted) showToast('This email has already voted.');
    }, 260);
  } catch (error) {
    console.error(error);
    state.voterEmail = '';
    state.emailReady = false;
    state.alreadyVoted = false;
    setEmailMessage('error', error?.message || 'Could not check this email. Please try again.');
  } finally {
    state.busy = false;
    updateEmailControls();
  }
}

function handleEmailInput() {
  setEmailMessage('', '');
}

async function castVote(entryId) {
  if (state.busy || !votingIsOpen()) return;

  if (!state.voterEmail || !state.emailReady) {
    showToast('Voting is not available for this email.');
    return;
  }

  if (state.alreadyVoted) {
    showToast('This email address has already voted.');
    return;
  }

  const entry = state.entries.find((item) => Number(item.id) === Number(entryId));
  const entryName = entry?.title || 'this entry';
  const confirmed = window.confirm(
    `Confirm your vote for ${entryName}? Once submitted, your vote cannot be changed.`
  );
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
    showToast('Your vote has been recorded and locked.');

    await loadPublicStatus();
    renderEntries();
  } catch (error) {
    console.error(error);

    if (String(error?.message || '').toLowerCase().includes('already voted')) {
      state.alreadyVoted = true;
      state.emailReady = false;
    }

    showToast(error?.message || 'Your vote could not be recorded. Please try again.');
    await loadPublicStatus().catch(() => {});
    renderEntries();
  } finally {
    state.busy = false;
    renderEntries();
  }
}

async function loadResults() {
  if (!resultsAvailable()) {
    state.results = {};
    state.resultsLoaded = false;
    renderEntries();
    return;
  }

  const { data, error } = await supabaseClient.rpc('get_vote_results');
  if (error) {
    console.error('Could not load final results:', error);
    return;
  }

  const results = Array.isArray(data) ? data : [];
  const total = results.reduce((sum, item) => sum + Number(item.vote_count || 0), 0);
  const mapped = {};

  results.forEach((item) => {
    const votes = Number(item.vote_count || 0);
    mapped[String(item.entry_id)] = {
      vote_count: votes,
      percentage: total ? Math.round((votes / total) * 100) : 0,
    };
  });

  state.results = mapped;
  state.resultsLoaded = true;
  renderEntries();
}

async function refreshStatusQuietly() {
  try {
    await loadPublicStatus();
    if (resultsAvailable() && !state.resultsLoaded) await loadResults();
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
    if (resultsAvailable()) await loadResults();
    updateEmailControls();

    countdownTimer = window.setInterval(tickCountdown, 1000);
    statusPollTimer = window.setInterval(refreshStatusQuietly, 3000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshStatusQuietly();
    });
  } catch (error) {
    console.error(error);
    setStatus('closed', 'Voting page is temporarily unavailable');
    els.emptyState.hidden = false;
    setEmailMessage('error', 'The competition could not be loaded. Please refresh and try again.');
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
