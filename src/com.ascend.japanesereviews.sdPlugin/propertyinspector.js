let websocket = null;
let uuid = null;
let actionInfo = {};

function showFieldsBySelectedWebsite() {
  const website = document.getElementById('websiteSelect').value;
  const passGroup = document.getElementById('usernamePasswordGroup');
  const apiGroup = document.getElementById('apiKeyGroup');

  if (website === 'kitsun') {
    // Kitsun doesn't have an API yet, so we use username/password.
    apiGroup.className = 'hidden';
    passGroup.className = '';
  } else {
    // Every other site should use an API key.
    passGroup.className = 'hidden';
    apiGroup.className = '';

    const apiKeyField = document.getElementById('apiKey');

    if (website === 'bunpro') {
      apiKeyField.placeholder = 'Bunpro API Token';
    } else {
      apiKeyField.placeholder = 'Wanikani V2 API Token (read-only)';
    }
  }
}

function refreshSettings(settings) {
  const apiKeyField = document.getElementById('apiKey');
  const usernameField = document.getElementById('serviceUsername');
  const passwordField = document.getElementById('servicePassword');
  const websiteField = document.getElementById('websiteSelect');

  if (settings) {
    apiKeyField.value = settings.apiKey ?? '';
    usernameField.value = settings.username ?? '';
    passwordField.value = settings.password ?? '';
    websiteField.value = settings.website ?? 'bunpro';

    showFieldsBySelectedWebsite();
  }

  apiKeyField.disabled = false;
  usernameField.disabled = false;
  passwordField.disabled = false;
  websiteField.disabled = false;
}

function updateSettings() {
  const apiKeyField = document.getElementById('apiKey');
  const usernameField = document.getElementById('serviceUsername');
  const passwordField = document.getElementById('servicePassword');
  const websiteField = document.getElementById('websiteSelect');

  const setSettings = {};
  setSettings.event = 'setSettings';
  setSettings.context = uuid;
  setSettings.payload = {};
  setSettings.payload.apiKey = apiKeyField.value;
  setSettings.payload.username = usernameField.value;
  setSettings.payload.password = passwordField.value;
  setSettings.payload.website = websiteField.value;

  websocket.send(JSON.stringify(setSettings));
}

// Called by property inspector when the Website field changes.
// eslint-disable-next-line no-unused-vars
function onWebsiteChange() {
  showFieldsBySelectedWebsite();
  updateSettings();
}

// Called by Elgato Property Inspector to connect to the device
// eslint-disable-next-line no-unused-vars
function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, info, inActionInfo) {
  uuid = inUUID;
  actionInfo = JSON.parse(inActionInfo); // cache the info
  websocket = new WebSocket(`ws://localhost:${inPort}`);

  refreshSettings(actionInfo.payload.settings);

  websocket.onopen = function onOpenWebSocket() {
    const register = {
      event: inRegisterEvent,
      uuid: inUUID,
    };

    websocket.send(JSON.stringify(register));
  };

  websocket.onmessage = function onMessageReceived(evt) {
    // Received message from Stream Deck
    const jsonObj = JSON.parse(evt.data);
    switch (jsonObj.event) {
      case 'didReceiveSettings':
        refreshSettings(jsonObj.payload.settings);
        break;
      case 'propertyInspectorDidDisappear':
        updateSettings();
        break;
      default:
        break;
    }
  };
}
