const SUPABASE_URL = 'https://agcmyvzfjersvwoqwkkc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_d8fd_YY_Aewl3wyp7pE-Qg_prvNRYvv';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  settings: null,
  entries: [],
  images: [],
  myVote: null,
  voterToken: null,
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

function createUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

function getVoterToken() {
  const key = 'ganesha-idol-voter-token-v1';
  let token = localStorage.getItem(key);

  if (!token) {
    token = createUuid();
    localStorage.setItem(key, token);
  }

  return token;
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

async function loadMyVote() {
  const { data, error } = await supabaseClient.rpc('get_my_vote', {
    p_voter_token: state.voterToken,
  });

  if (error) throw error;
  state.myVote = Array.isArray(data) && data.length ? Number(data[0].entry_id) : null;
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

  visibleEntries.forEach((entry, index) => {
    const image = getImageForEntry(index);
    if (!image) return;

    const selected = state.myVote === Number(entry.id);
    const article = document.createElement('article');
    article.className = `entry-card${selected ? ' selected' : ''}`;
    article.dataset.entryId = entry.id;

    article.innerHTML = `
      <div class="entry-media" role="button" tabindex="0" aria-label="View ${escapeHtml(entry.title)} image">
        <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(entry.title)} Ganesha idol" loading="lazy" decoding="async" />
        <span class="entry-number">${String(entry.sort_order).padStart(2, '0')}</span>
      </div>
      <div class="entry-body">
        <div class="entry-copy">
          <h3>${escapeHtml(entry.title)}</h3>
          <p>${selected ? 'Your current choice' : 'Tap the image to view larger'}</p>
        </div>
        <button class="vote-button" type="button" ${!votingOpen || state.busy ? 'disabled' : ''}>
          ${selected ? 'Selected' : votingOpen ? 'Vote' : 'Voting closed'}
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

async function castVote(entryId) {
  if (state.busy || !votingIsOpen()) return;

  state.busy = true;
  renderEntries();

  try {
    const { data, error } = await supabaseClient.rpc('cast_vote', {
      p_entry_id: entryId,
      p_voter_token: state.voterToken,
    });

    if (error) throw error;

    const changed = Array.isArray(data) && data.length ? Boolean(data[0].changed) : true;
    state.myVote = entryId;
    showToast(changed ? 'Your vote has been recorded.' : 'That is already your selected entry.');

    await loadPublicStatus();
  } catch (error) {
    console.error(error);
    showToast(error?.message || 'Your vote could not be recorded. Please try again.');
    await loadPublicStatus().catch(() => {});
  } finally {
    state.busy = false;
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
  state.voterToken = getVoterToken();

  try {
    await loadSettingsAndEntries();
    await Promise.all([
      loadDriveImages(),
      loadMyVote(),
      loadPublicStatus(),
    ]);

    renderEntries();
    await loadResults();

    countdownTimer = window.setInterval(tickCountdown, 1000);
    statusPollTimer = window.setInterval(refreshStatusQuietly, 5000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshStatusQuietly();
    });
  } catch (error) {
    console.error(error);
    setStatus('closed', 'Voting page is temporarily unavailable');
    els.emptyState.hidden = false;
  }
}

els.closeDialog.addEventListener('click', closeImage);
els.imageDialog.addEventListener('click', (event) => {
  if (event.target === els.imageDialog) closeImage();
});

window.addEventListener('pagehide', () => {
  if (statusPollTimer) window.clearInterval(statusPollTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
});

init();
