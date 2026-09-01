const SUPABASE_URL = 'https://agcmyvzfjersvwoqwkkc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_d8fd_YY_Aewl3wyp7pE-Qg_prvNRYvv';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  settings: null,
  entries: [],
  images: [],
  myVote: null,
  voterToken: null,
  busy: false,
};

const els = {
  statusBanner: document.getElementById('statusBanner'),
  statusText: document.getElementById('statusText'),
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

function getVoterToken() {
  const key = 'ganesha-idol-voter-token-v1';
  let token = localStorage.getItem(key);

  if (!token) {
    token = crypto.randomUUID();
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function naturalSort(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

async function loadSettingsAndEntries() {
  const [settingsResponse, entriesResponse] = await Promise.all([
    supabaseClient
      .from('vote_settings')
      .select('event_title,event_subtitle,event_date,voting_open,show_results,image_feed_url,drive_folder_id')
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

  visibleEntries.forEach((entry, index) => {
    const image = getImageForEntry(index);
    const selected = state.myVote === Number(entry.id);
    const votingOpen = Boolean(state.settings?.voting_open);

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
  els.imageDialog.showModal();
}

async function castVote(entryId) {
  if (state.busy || !state.settings?.voting_open) return;

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

    if (state.settings.show_results) {
      await loadResults();
    }
  } catch (error) {
    console.error(error);
    showToast(error?.message || 'Your vote could not be recorded. Please try again.');
  } finally {
    state.busy = false;
    renderEntries();
  }
}

async function loadResults() {
  if (!state.settings?.show_results) {
    els.resultsSection.hidden = true;
    return;
  }

  const { data, error } = await supabaseClient.rpc('get_vote_results');
  if (error) {
    els.resultsSection.hidden = true;
    return;
  }

  const results = Array.isArray(data) ? data : [];
  const total = results.reduce((sum, item) => sum + Number(item.vote_count || 0), 0);
  const highest = Math.max(...results.map((item) => Number(item.vote_count || 0)), 1);

  els.resultsList.innerHTML = results.map((item) => {
    const votes = Number(item.vote_count || 0);
    const width = Math.max(0, Math.min(100, (votes / highest) * 100));
    return `
      <div class="result-row">
        <span class="result-name">${escapeHtml(item.title)}</span>
        <div class="result-track" aria-hidden="true"><div class="result-fill" style="width:${width}%"></div></div>
        <span class="result-count">${votes}${total ? ` · ${Math.round((votes / total) * 100)}%` : ''}</span>
      </div>
    `;
  }).join('');

  els.resultsSection.hidden = false;
}

async function init() {
  state.voterToken = getVoterToken();

  try {
    await loadSettingsAndEntries();

    if (state.settings.voting_open) {
      setStatus('open', 'Voting is open');
    } else {
      setStatus('closed', 'Voting is closed');
    }

    await Promise.all([
      loadDriveImages(),
      loadMyVote(),
    ]);

    renderEntries();
    await loadResults();
  } catch (error) {
    console.error(error);
    setStatus('closed', 'Voting page is temporarily unavailable');
    els.emptyState.hidden = false;
  }
}

els.closeDialog.addEventListener('click', () => els.imageDialog.close());
els.imageDialog.addEventListener('click', (event) => {
  if (event.target === els.imageDialog) els.imageDialog.close();
});

init();
