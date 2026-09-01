const FOLDER_ID = '1VSzL0_kOhF3v_GuAJV4ReRvQbB0ea3x-';
const MAX_IMAGES = 4;

function doGet() {
  const files = [];
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const iterator = folder.getFiles();

  while (iterator.hasNext()) {
    const file = iterator.next();
    const mimeType = String(file.getMimeType() || '');

    if (!mimeType.startsWith('image/')) continue;

    files.push({
      id: file.getId(),
      name: file.getName(),
      mimeType: mimeType,
      imageUrl: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) + '&sz=w2000',
      updatedAt: file.getLastUpdated().toISOString(),
    });
  }

  files.sort(function(a, b) {
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });

  const payload = {
    files: files.slice(0, MAX_IMAGES),
    count: Math.min(files.length, MAX_IMAGES),
    folderId: FOLDER_ID,
    generatedAt: new Date().toISOString()
  };

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
