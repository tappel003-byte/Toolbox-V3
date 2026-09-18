// Toolbox — client configuration.
//
// Toolbox is a build-less static PWA: there is no server-side step that
// could inject a secret at deploy time, so this file is committed and
// served exactly like every other file in js/. It is not a secrets
// mechanism, and it isn't meant to be one.
//
// geoapifyApiKey is a Geoapify browser API key, created for Toolbox and
// restricted in the Geoapify dashboard to the production Toolbox domain.
// A domain-restricted browser key is *meant* to be client-visible — the
// domain restriction is what keeps it safe to ship in a static site, not
// secrecy. There is no benefit to hiding it behind extra infrastructure.
//
// To enable address autocomplete and "Use Current Location": edit this
// file directly, set geoapifyApiKey to the real key, then commit and push.
// Leave it as an empty string until then — an empty key simply disables
// the Geoapify conveniences. Manual address entry is unaffected either way.
window.ToolboxConfig = {
  geoapifyApiKey: 'c77231dd6511494cb976808bf46fd35c',
};
