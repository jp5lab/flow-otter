module.exports = {
  flowFile: 'flows.json',
  flowFilePretty: false,
  uiPort: process.env.PORT || 1880,
  diagnostics: { enabled: true, ui: false },
  runtimeState: { enabled: true, ui: false },
  logging: {
    console: { level: 'info', metrics: false, audit: false },
  },
  exportGlobalContextKeys: false,
  editorTheme: {
    projects: { enabled: false },
    palette: { editable: false },
  },
  functionExternalModules: false,
  functionGlobalContext: {},
  debugMaxLength: 1000,
  mqttReconnectTime: 15000,
  serialReconnectTime: 15000,
};
