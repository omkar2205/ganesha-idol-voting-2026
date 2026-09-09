const SUPABASE_URL = 'https://agcmyvzfjersvwoqwkkc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_d8fd_YY_Aewl3wyp7pE-Qg_prvNRYvv';
const ALLOWED_DOMAIN = '@guseducationindia.com';
const MAX_ENTRIES = 12;
const EMAIL_STORAGE_KEY = 'ganesha-idol-locked-email-v1';

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

const ELEPHANT_ICON_URL = 'https://drive.google.com/thumbnail?id=1BodiuRQPzWt0wYjGOJ-dSt16JaUz3Mpg&sz=w512';

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

function getStoredEmail() {
  try {
    const stored = normalizeEmail(localStorage.getItem(EMAIL_STORAGE_KEY));
    if (stored && isAllowedEmail(stored)) return stored;
    if (stored) localStorage.removeItem(EMAIL_STORAGE_KEY);
  } catch (error) {
    console.warn('Could not read locked email:', error);
  }
  return '';
}

function storeEmailForBrowser(email) {
  try {
    localStorage.setItem(EMAIL_STORAGE_KEY, normalizeEmail(email));
  } catch (error) {
    console.warn('Could not lock email to this browser:', error);
  }
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

function votingEndedByTimer() {
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

function closeEmailGate() {
  document.body.classList.remove('gate-open');
  els.emailOverlay.hidden = true;
}

function openEmailGate() {
  if (state.voterEmail || !votingIsOpen()) {
    closeEmailGate();
    return;
  }

  els.emailOverlay.hidden = false;
  document.body.classList.add('gate-open');
  window.setTimeout(() => els.emailInput.focus(), 60);
}

function updateEmailControls() {
  const enabled = votingIsOpen() && !state.voterEmail;
  els.emailInput.disabled = !enabled || state.busy;
  els.emailButton.disabled = !enabled || state.busy;
}

function getVisibleEntries() {
  const sortedEntries = [...state.entries].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const byOrder = new Map(sortedEntries.map((entry) => [Number(entry.sort_order), entry]));
  const entries = [];

  for (let index = 1; index <= MAX_ENTRIES; index += 1) {
    entries.push(byOrder.get(index) || {
      id: index,
      slug: `team-${String(index).padStart(2, '0')}`,
      title: `Team ${String(index).padStart(2, '0')}`,
      sort_order: index,
      active: true,
    });
  }

  return entries;
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
    throw new Error('Could not load the competition photographs.');
  }

  const payload = await response.json();
  const files = Array.isArray(payload) ? payload : payload.files;

  state.images = (Array.isArray(files) ? files : [])
    .filter((file) => file && file.id && file.imageUrl)
    .sort(naturalSort)
    .slice(0, MAX_ENTRIES);
}

async function checkEmailAlreadyVoted(email) {
  const { data, error } = await supabaseClient.rpc('has_email_voted', {
    p_voter_email: email,
  });

  if (error) throw error;
  return Boolean(data);
}

async function applyLockedBrowserEmail() {
  const lockedEmail = getStoredEmail();
  if (!lockedEmail) return;

  state.voterEmail = lockedEmail;
  state.emailReady = false;
  state.alreadyVoted = false;
  state.myVote = null;

  const alreadyVoted = await checkEmailAlreadyVoted(lockedEmail);
  state.alreadyVoted = alreadyVoted;
  state.emailReady = !alreadyVoted && votingIsOpen();
}

async function loadPublicStatus() {
  const previousOpen = votingIsOpen();

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

  if (!votingIsOpen() || state.voterEmail) {
    closeEmailGate();
  }

  const currentOpen = votingIsOpen();
  if (previousOpen !== currentOpen) renderEntries();
}

function updateLivePanel() {
  const total = Number(state.publicStatus?.total_votes || 0);
  els.totalVotes.textContent = Number.isFinite(total) ? total.toLocaleString() : '0';

  if (!state.publicStatus) {
    els.countdown.textContent = 'Waiting';
    return;
  }

  if (votingEndedByTimer()) {
    setStatus('closed', 'Voting has ended');
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00:00';
    els.countdownNote.textContent = 'Results are with the admin team';
    return;
  }

  if (!state.publicStatus.first_vote_at || !state.publicStatus.results_reveal_at) {
    setStatus(votingIsOpen() ? 'open' : 'closed', votingIsOpen() ? 'Voting is open' : 'Voting is closed');
    els.countdownLabel.textContent = 'Countdown';
    els.countdown.textContent = 'Waiting';
    els.countdownNote.textContent = 'Starts with the first vote';
    return;
  }

  const remaining = remainingMs();
  if (remaining !== null && remaining > 0) {
    setStatus(votingIsOpen() ? 'open' : 'closed', votingIsOpen() ? 'Voting is open' : 'Voting is closed');
    els.countdownLabel.textContent = 'Voting closes in';
    els.countdown.textContent = formatCountdown(remaining);
    els.countdownNote.textContent = 'Team totals stay hidden';
  } else {
    setStatus('closed', 'Voting has ended');
    els.countdownLabel.textContent = 'Voting ended';
    els.countdown.textContent = '00:00:00';
    els.countdownNote.textContent = 'Results are with the admin team';
  }
}

function tickCountdown() {
  const wasOpen = votingIsOpen();
  updateLivePanel();
  updateEmailControls();
  const isOpen = votingIsOpen();

  if (wasOpen !== isOpen) renderEntries();

  if (state.publicStatus?.results_reveal_at && remainingMs() === 0 && !expiryRefreshPending) {
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

function renderPlaceholder(entry) {
  const number = String(entry.sort_order || entry.id).padStart(2, '0');
  return `
    <div class="placeholder-visual" aria-label="Placeholder for ${escapeHtml(entry.title)}">
      <span class="placeholder-stack">
        <span class="placeholder-symbol"><img class="elephant-inline" src="${ELEPHANT_ICON_URL}" alt="" /></span>
        <span class="placeholder-text">Photo coming soon</span>
      </span>
    </div>
    <span class="entry-number">${number}</span>
  `;
}

function renderEntries() {
  els.entriesGrid.innerHTML = '';

  const visibleEntries = getVisibleEntries();
  if (!visibleEntries.length) {
    els.emptyState.hidden = false;
    return;
  }

  els.emptyState.hidden = true;
  const votingOpen = votingIsOpen();
  const canVote = votingOpen && state.emailReady && !state.alreadyVoted && !state.busy;

  visibleEntries.forEach((entry, index) => {
    const image = getImageForEntry(index);
    const hasImage = Boolean(image?.imageUrl);
    const selected = state.myVote === Number(entry.id);
    const article = document.createElement('article');
    article.className = `entry-card${selected ? ' selected' : ''}`;
    article.dataset.entryId = entry.id;

    let buttonText = 'Enter email to vote';
    if (!votingOpen) buttonText = 'Voting closed';
    else if (selected) buttonText = 'Vote cast';
    else if (state.alreadyVoted) buttonText = 'Vote locked';
    else if (state.emailReady) buttonText = 'Vote';

    let detailText = hasImage ? 'Tap image to view larger' : 'Placeholder until photo is uploaded';
    if (!votingOpen) detailText = 'Voting has ended';
    else if (selected) detailText = 'Your vote is locked';
    else if (state.alreadyVoted) detailText = 'This email has already voted';
    else if (state.voterEmail && state.emailReady) detailText = 'Ready to vote';

    const mediaContent = hasImage
      ? `<img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(entry.title)} Ganesha idol" loading="lazy" decoding="async" />
         <span class="entry-number">${String(entry.sort_order).padStart(2, '0')}</span>`
      : renderPlaceholder(entry);

    article.innerHTML = `
      <div class="entry-media${hasImage ? ' has-image' : ''}" ${hasImage ? `role="button" tabindex="0" aria-label="View ${escapeHtml(entry.title)} image"` : ''}>
        ${mediaContent}
      </div>
      <div class="entry-body">
        <div class="entry-copy">
          <h2 class="entry-title">${escapeHtml(entry.title)}</h2>
          <p>${detailText}</p>
        </div>
        <button class="vote-button" type="button" ${canVote ? '' : 'disabled'}>${buttonText}</button>
      </div>
    `;

    const media = article.querySelector('.entry-media');
    const voteButton = article.querySelector('.vote-button');

    if (hasImage) {
      const openImage = () => showImage(image.imageUrl, entry.title);
      media.addEventListener('click', openImage);
      media.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openImage();
        }
      });
    }

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

  if (state.voterEmail) {
    closeEmailGate();
    return;
  }

  const email = normalizeEmail(els.emailInput.value);
  if (!isAllowedEmail(email)) {
    setEmailMessage('error', 'Please enter a valid @guseducationindia.com email address.');
    renderEntries();
    return;
  }

  state.busy = true;
  state.voterEmail = '';
  state.emailReady = false;
  state.alreadyVoted = false;
  state.myVote = null;
  updateEmailControls();
  renderEntries();

  try {
    const alreadyVoted = await checkEmailAlreadyVoted(email);
    state.voterEmail = email;
    state.alreadyVoted = alreadyVoted;
    state.emailReady = !alreadyVoted && votingIsOpen();
    storeEmailForBrowser(email);

    if (alreadyVoted) {
      setEmailMessage('error', 'This email address has already voted.');
    } else {
      setEmailMessage('success', 'Email accepted.');
    }

    closeEmailGate();
  } catch (error) {
    console.error(error);
    state.voterEmail = '';
    state.emailReady = false;
    state.alreadyVoted = false;
    state.myVote = null;
    setEmailMessage('error', error?.message || 'Could not check this email. Please try again.');
  } finally {
    state.busy = false;
    updateEmailControls();
    renderEntries();
  }
}

async function castVote(entryId) {
  if (state.busy || !votingIsOpen()) return;

  if (!state.voterEmail || !state.emailReady) {
    if (!state.voterEmail) openEmailGate();
    showToast('Enter your work email first.');
    return;
  }

  if (state.alreadyVoted) {
    showToast('This email address has already voted.');
    return;
  }

  const entry = getVisibleEntries().find((item) => Number(item.id) === Number(entryId));
  const entryName = entry?.title || 'this team';
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
    showToast('Your vote has been recorded and locked.');

    await loadPublicStatus();
  } catch (error) {
    console.error(error);

    if (String(error?.message || '').toLowerCase().includes('already voted')) {
      state.alreadyVoted = true;
      state.emailReady = false;
    }

    showToast(error?.message || 'Your vote could not be recorded. Please try again.');
    await loadPublicStatus().catch(() => {});
  } finally {
    state.busy = false;
    updateEmailControls();
    renderEntries();
  }
}

async function refreshStatusQuietly() {
  try {
    await loadPublicStatus();
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

    await applyLockedBrowserEmail();

    if (!state.voterEmail && votingIsOpen()) {
      openEmailGate();
    } else {
      closeEmailGate();
    }

    renderEntries();
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
els.closeDialog.addEventListener('click', closeImage);
els.imageDialog.addEventListener('click', (event) => {
  if (event.target === els.imageDialog) closeImage();
});

window.addEventListener('pagehide', () => {
  if (statusPollTimer) window.clearInterval(statusPollTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
});

init();