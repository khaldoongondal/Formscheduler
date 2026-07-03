function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const trackingSources = [
  { key: "fbclid", cookies: ["_lgs_fbclid"] },
  { key: "fbc", cookies: ["_fbc", "_lgs_fbc"] },
  { key: "fbp", cookies: ["_fbp", "_lgs_fbp"] },
  { key: "gclid", cookies: ["_gcl_aw", "_lgs_gclid"] },
  { key: "ttclid", cookies: ["_ttp", "_lgs_ttclid"] },
  { key: "utm_source", cookies: ["_lgs_utm_source"] },
  { key: "utm_medium", cookies: ["_lgs_utm_medium"] },
  { key: "utm_campaign", cookies: ["_lgs_utm_campaign"] },
  { key: "utm_content", cookies: ["_lgs_utm_content"] },
  { key: "utm_term", cookies: ["_lgs_utm_term"] },
  { key: "utm_adset", cookies: ["_lgs_utm_adset"] },
  { key: "utm_adid", cookies: ["_lgs_utm_adid"] },
  { key: "utm_adsetid", cookies: ["_lgs_utm_adsetid"] },
  { key: "utm_campaignid", cookies: ["_lgs_utm_campaignid"] },
  { key: "utm_id", cookies: ["_lgs_utm_id"] },
  { key: "split_test_id", cookies: ["_lgs_split_test_id"] },
  { key: "split_variant", cookies: ["_lgs_split_variant"] },
  { key: "landing_page_url", cookies: ["_lgs_landing_page_url"] }
] as const;

function getTrackingSourcesScriptArray() {
  return JSON.stringify(trackingSources);
}

function getTrackingSourcesBacktickArray() {
  return `[${trackingSources
    .map(
      (source) =>
        `{key:\`${source.key}\`,cookies:[${source.cookies.map((cookieName) => `\`${cookieName}\``).join(",")}]}`
    )
    .join(",")}]`;
}

function buildParentRedirectListener(embedUrl: string) {
  const embedOrigin = new URL(embedUrl).origin;

  return `<script>
(function () {
  var leadderOrigin = ${JSON.stringify(embedOrigin)};
  window.addEventListener("message", function (event) {
    if (event.origin !== leadderOrigin) return;
    var data = event.data || {};
    if (data.type === "leadder:redirect" && typeof data.url === "string") {
      window.location.href = data.url;
    }
  });
})();
</script>`;
}

export function buildIframeSnippet(embedUrl: string) {
  return buildGhlSafeIframeSnippet(embedUrl);
}

export function buildPopupSnippet(embedUrl: string) {
  return `${buildParentRedirectListener(embedUrl)}
<button type="button" data-leadder-popup-url="${escapeAttribute(embedUrl)}">Book now</button>
<script>
(function () {
  var button = document.currentScript && document.currentScript.previousElementSibling;
  if (!button) return;

  button.addEventListener("click", function () {
    var trackingSources = ${getTrackingSourcesScriptArray()};
    var sourceParams = new URLSearchParams(window.location.search);
    var url = new URL(button.getAttribute("data-leadder-popup-url"));

    function cookie(name) {
      var match = document.cookie.match("(?:^|; )" + name + "=([^;]*)");
      return match ? decodeURIComponent(match[1]) : null;
    }

    function valueFor(source) {
      for (var i = 0; i < source.cookies.length; i += 1) {
        var cookieValue = cookie(source.cookies[i]);
        if (cookieValue) return cookieValue;
      }
      return sourceParams.get(source.key);
    }

    if (!url.searchParams.has("landing_page_url")) {
      url.searchParams.set("landing_page_url", window.location.href);
    }

    trackingSources.forEach(function (source) {
      if (url.searchParams.has(source.key)) return;
      var value = valueFor(source);
      if (value) {
        url.searchParams.set(source.key, value);
      }
    });

    window.open(url.toString(), "leadder", "width=520,height=760");
  });
})();
</script>`;
}

function appendQueryParams(url: string, params: Record<string, string>) {
  const nextUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    nextUrl.searchParams.set(key, value);
  });
  return nextUrl.toString();
}

function buildGhlSafeIframeSnippet(embedUrl: string) {
  const embedOrigin = new URL(embedUrl).origin;

  return `<!-- Leadder iframe embed -->
<div></div>
<script>
(function () {
  var leadderOrigin = \`${embedOrigin}\`;
  var container = document.currentScript && document.currentScript.previousElementSibling;
  if (!container) return;

  var url = new URL(\`${embedUrl}\`);
  var trackingSources = ${getTrackingSourcesBacktickArray()};
  var sourceParams = new URLSearchParams(window.location.search);

  function cookie(name) {
    var parts = document.cookie ? document.cookie.split(\`; \`) : [];
    var prefix = name + \`=\`;
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].indexOf(prefix) === 0) {
        return decodeURIComponent(parts[i].slice(prefix.length));
      }
    }
    return null;
  }

  function valueFor(source) {
    for (var i = 0; i < source.cookies.length; i += 1) {
      var cookieValue = cookie(source.cookies[i]);
      if (cookieValue) return cookieValue;
    }
    return sourceParams.get(source.key);
  }

  if (!url.searchParams.has(\`landing_page_url\`)) {
    url.searchParams.set(\`landing_page_url\`, window.location.href);
  }

  trackingSources.forEach(function (source) {
    if (url.searchParams.has(source.key)) return;
    var value = valueFor(source);
    if (value) {
      url.searchParams.set(source.key, value);
    }
  });

  window.addEventListener(\`message\`, function (event) {
    if (event.origin !== leadderOrigin) return;
    var data = event.data || {};
    if (data.type === \`leadder:redirect\` && typeof data.url === \`string\`) {
      window.location.href = data.url;
    }
  });

  var iframe = document.createElement(\`iframe\`);
  iframe.src = url.toString();
  iframe.width = \`100%\`;
  iframe.height = \`760\`;
  iframe.setAttribute(\`allow\`, \`clipboard-write\`);
  iframe.style.border = \`0\`;
  iframe.style.display = \`block\`;
  iframe.style.width = \`100%\`;
  container.style.width = \`100%\`;

  container.innerHTML = \`\`;
  container.appendChild(iframe);
})();
</script>`;
}

export function buildSplitTestIframeSnippet(embedUrl: string, input: { splitTestId: string; splitVariant: string }) {
  return buildGhlSafeIframeSnippet(
    appendQueryParams(embedUrl, {
      split_test_id: input.splitTestId,
      split_variant: input.splitVariant
    })
  );
}
