/** HubSpot constants and copy (decision C17). Pure: no imports. */
export const HUBSPOT_API_BASE = "https://api.hubapi.com";
/** U17: private app tokens start with "pat-" and a region code. */
export const HUBSPOT_TOKEN_PATTERN = /^pat-[a-z0-9]{2,8}-[A-Za-z0-9-]{20,200}$/;

export const HUBSPOT_COPY = {
  createHeading: "Add HubSpot",
  createIntro: "FormBook creates or updates a HubSpot contact for every lead and can create deals.",
  nameLabel: "Name",
  defaultName: "HubSpot",
  tokenLabel: "Private app access token",
  tokenHelp:
    "In HubSpot, create a private app under Settings, Integrations, Private apps. Give it these scopes: crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.read, crm.objects.deals.write. Copy its access token here.",
  scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read", "crm.objects.deals.write"],
  createButton: "Add HubSpot",
  tokenPattern: "That does not look like a HubSpot private app token. It starts with pat-.",
  tokenRejected: "HubSpot did not accept this token.",
  tokenMissingScope: "This token is missing a scope. Check the scopes listed above.",
  tokenCheckFailed: "HubSpot could not be reached. Please try again.",
  alreadyConnected: "This HubSpot account is already connected.",
  otherAccount: "This token belongs to another HubSpot account. Add it as a new connection instead.",
  created: "HubSpot connected. Choose it under Send leads to on each form.",
  tokenReplaced: "Access token replaced.",
  portalLabel: (portalId: string) => `HubSpot portal ${portalId}`,
  tokenEnding: (lastFour: string) => `Token ending in ${lastFour}`,
  replaceToken: "Replace token",
  tokenNoLongerAccepted: "HubSpot no longer accepts the access token. Paste a new token on this connection.",
  scopeMissingRuntime: "The HubSpot token is missing a scope FormBook needs. Check the private app scopes, then paste the token again.",
  checkOk: "HubSpot accepted the access token.",
  checkFailed: "HubSpot did not answer. Please try again later.",
  // Form editor panel.
  panelIntro: "FormBook creates or updates the contact for every lead and adds a note with the answers and tracking details.",
  dealOnLead: "Create a deal for every new lead",
  dealOnBooked: "Create or move a deal when a call is booked",
  pipelineLabel: "Pipeline",
  pipelinePlaceholder: "Choose a pipeline",
  leadStageLabel: "Stage for new leads",
  bookedStageLabel: "Stage for booked calls",
  disqualifiedStageLabel: "Stage for disqualified leads (optional)",
  stagePlaceholder: "Choose a stage",
  noStage: "Do not move",
  saveForStages: "Save to load the stages for this pipeline.",
  dealNameLabel: "Deal name",
  dealNameHelp: "Tokens: {{lead_name}}, {{first_name}}, {{last_name}}, {{email}}, {{phone}}, {{funnel_name}}.",
  pipelinesLoadFailed: "Could not load your HubSpot pipelines. Check the connection under Connections.",
  choosePipeline: "Choose a pipeline and stages from the lists.",
  // Notes.
  noteTitles: {
    "lead.captured": "FormBook: new lead",
    "lead.qualified": "FormBook: answers",
    "lead.disqualified": "FormBook: disqualified",
    "lead.booked": "FormBook: call booked",
    "test.ping": "FormBook: test"
  }
} as const;
