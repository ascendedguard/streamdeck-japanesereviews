let websocket = null;
let pluginUUID = null;
let reviewIntervalTimer = null;

const supportedSites = {
  bunpro: {
    reviewUrl: 'https://bunpro.jp/dashboard',
    icon: 'bunpro.png',
    getReviewValue(settings, callback) {
      const { apiKey } = settings;

      if (apiKey == null) return;

      const requestHeaders = new Headers({
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
      });

      const apiEndpoint = new Request(`https://bunpro.jp/api/user/${apiKey}/study_queue`, {
        method: 'GET',
        headers: requestHeaders,
      });

      fetch(apiEndpoint, { cache: 'no-store' })
        .then((response) => response.json())
        .then((responseBody) => callback(responseBody.requested_information.reviews_available));
    },
  },

  wanikani: {
    reviewUrl: 'https://www.wanikani.com/review',
    icon: 'wanikani.png',
    getReviewValue(settings, callback) {
      const { apiKey } = settings;

      const requestHeaders = new Headers({
        'Wanikani-Revision': '20170710',
        Authorization: `Bearer ${apiKey}`,
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
      });

      const apiEndpoint = new Request('https://api.wanikani.com/v2/summary', {
        method: 'GET',
        headers: requestHeaders,
      });

      fetch(apiEndpoint, { cache: 'no-store' })
        .then((response) => response.json())
        .then((responseBody) => callback(responseBody.data.reviews[0].subject_ids.length));
    },
  },

  'marumori-vocab': {
    reviewUrl: 'https://marumori.io/study-lists/reviews',
    icon: 'marumori.png',
    getReviewValue(settings, callback) {
      const { apiKey } = settings;

      const requestHeaders = new Headers({
        Authorization: `Bearer ${apiKey}`,
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
      });

      const apiEndpoint = new Request('https://public-api.marumori.io/home', {
        method: 'GET',
        headers: requestHeaders,
      });

      fetch(apiEndpoint, { cache: 'no-store' })
        .then((response) => response.json())
        .then((responseBody) => callback(responseBody.data.counts.reviews));
    },
  },

  'marumori-grammar': {
    reviewUrl: 'https://marumori.io/study-lists/reviews?grammar=true',
    icon: 'marumori.png',
    getReviewValue(settings, callback) {
      const { apiKey } = settings;

      const requestHeaders = new Headers({
        Authorization: `Bearer ${apiKey}`,
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
      });

      const apiEndpoint = new Request('https://public-api.marumori.io/home', {
        method: 'GET',
        headers: requestHeaders,
      });

      fetch(apiEndpoint, { cache: 'no-store' })
        .then((response) => response.json())
        .then((responseBody) => callback(responseBody.data.counts.grammarReviews));
    },
  },
};

const DestinationEnum = Object.freeze(
  {
    HARDWARE_AND_SOFTWARE: 0,
    HARDWARE_ONLY: 1,
    SOFTWARE_ONLY: 2,
  },
);

const reviewsAction = {
  type: 'com.ascend.japanesereviews.action',

  onKeyUp(context, settings) {
    const site = supportedSites[settings.website];
    const { reviewUrl } = site;

    const json = {
      event: 'openUrl',
      payload: {
        url: reviewUrl,
      },
    };

    websocket.send(JSON.stringify(json));
  },

  // Cache the last saved count and time of the sync
  // Otherwise, when you change folders/pages on the
  // StreamDeck, the plugin reloads and APIs get hit again.
  storeLastValues(context, settings, count) {
    const setSettings = {};
    setSettings.event = 'setSettings';
    setSettings.context = context;
    setSettings.payload = settings;
    setSettings.payload.lastCount = count;
    setSettings.payload.lastDateTime = (new Date()).toISOString();

    websocket.send(JSON.stringify(setSettings));
  },

  updateReviews(context, settings) {
    const site = supportedSites[settings.website];

    // MaruMori API has a rate limit of 1 (!) request every 250ms.
    // As such, having vocab AND grammar icons will hit a 429 error...
    // We wait an additional 1 second on grammar to mitigate this.
    let delay = 0;

    if (settings.website === 'marumori-grammar') {
      delay = 1000;
    }

    setTimeout(() => {
      site.getReviewValue(settings, (count) => {
        this.buildImageAsDataUri(context, settings, count);
        this.storeLastValues(context, settings, count);
      });
    }, delay);
  },

  scheduleReviews(context, settings) {
    if (reviewIntervalTimer != null) clearInterval(reviewIntervalTimer);

    const lastDate = new Date(settings.lastDateTime);
    const count = settings.lastCount;

    // If lastDateTime === undefined or something invalid, the comparison will still be false.
    const updatedLessThanTenMinutesAgo = (new Date() - lastDate) / 1000 / 60 < 10;

    // If we just updated, we can just display the saved value and wait till the next update.
    if (!updatedLessThanTenMinutesAgo || count === undefined) {
      this.buildImageAsDataUri(context, settings, '...');
      this.updateReviews(context, settings);
    } else {
      this.buildImageAsDataUri(context, settings, count);
    }

    // Schedule so it triggers every 10 minutes, starting 1 past the hour
    // so we don't accidentally miss the typical hourly update. 10m updates
    // lets us catch most in-process reviews.

    // Minimum 2 minutes until next (e.g. 10:29), maximum 11 (e.g. 10:30)
    const minutesTillFirstReview = 10 - (new Date().getMinutes() % 10) + 1;
    const firstReviewMilliseconds = minutesTillFirstReview * 60 * 1000;

    setTimeout(() => {
      this.updateReviews(context, settings);

      // Update every 10 minutes
      const interval = 10 * 60 * 1000;
      reviewIntervalTimer = setInterval(() => {
        this.updateReviews(context, settings);
      }, interval);
    }, firstReviewMilliseconds);
  },

  onWillAppear(context, settings) {
    if (settings.apiKey) {
      this.scheduleReviews(context, settings);
    } else {
      this.buildImageAsDataUri(context, settings, 'key?');
    }
  },

  setImage(context, data) {
    const json = {
      event: 'setImage',
      context,
      payload: {
        image: data || '',
        target: DestinationEnum.HARDWARE_AND_SOFTWARE,
      },
    };

    websocket.send(JSON.stringify(json));
  },

  buildImageAsDataUri(context, settings, text) {
    const site = supportedSites[settings.website];

    const { icon } = site;

    const image = new Image();
    const base = this;

    // Once the image loads, we render the middle text showing
    // the number of reviews - blurred black box with a variable
    // width based on the length of the count string.
    image.onload = function loadImage() {
      const canvas = document.createElement('canvas');

      const { length } = text.toString();

      const width = 12 * length + 4;
      const x = (this.naturalWidth / 2) - (width / 2);

      canvas.width = this.naturalWidth;
      canvas.height = this.naturalHeight;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(this, 0, 0);

      ctx.fillStyle = '#000a';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 5;
      ctx.filter = 'blur(4px)';
      ctx.fillRect(x, 24, width, 26);

      ctx.filter = 'none';
      ctx.fillStyle = '#fff';
      ctx.font = '22px "Trebuchet MS"';

      ctx.fillText(text, x + 2, 45);

      base.setImage(context, canvas.toDataURL('image/png'));
    };

    image.src = icon;
  },
};

// Steam Deck Registration - required
// eslint-disable-next-line no-unused-vars
function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent) {
  pluginUUID = inPluginUUID;

  // Open the web socket
  websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);

  function registerPlugin(uuid) {
    const json = {
      event: inRegisterEvent,
      uuid,
    };

    websocket.send(JSON.stringify(json));
  }

  websocket.onopen = function onSocketOpen() {
    // WebSocket is connected, send message
    registerPlugin(pluginUUID);
  };

  websocket.onmessage = function onMessageReceived(evt) {
    // Received message from Stream Deck
    const jsonObj = JSON.parse(evt.data);
    const { event } = jsonObj;
    const { context } = jsonObj;
    const jsonPayload = jsonObj.payload || {};

    if (event === 'keyUp') {
      const { settings } = jsonPayload;
      const { coordinates } = jsonPayload;
      const { userDesiredState } = jsonPayload;

      reviewsAction.onKeyUp(context, settings, coordinates, userDesiredState);
    } else if (event === 'willAppear') {
      const { settings } = jsonPayload;

      reviewsAction.onWillAppear(context, settings);
    } else if (event === 'didReceiveSettings') {
      reviewsAction.onWillAppear(context, jsonPayload.settings);
    }
  };
}
