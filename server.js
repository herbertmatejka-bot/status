const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const AWS_HEALTH_URL = 'https://health.aws.amazon.com/public/currentevents';

const SERVICES = [
  // LLMs
  { name: 'OpenAI',       url: 'https://status.openai.com/api/v2/summary.json',              type: 'statuspage',  icon: 'openai',    homepage: 'https://status.openai.com',           group: 'LLMs' },
  { name: 'Anthropic',    url: 'https://status.claude.com/api/v2/summary.json',              type: 'statuspage',  icon: 'anthropic', homepage: 'https://status.anthropic.com',        group: 'LLMs' },
  // Transcribers
  { name: 'Deepgram',     url: 'https://status.deepgram.com/api/v2/summary.json',            type: 'statuspage',  icon: 'deepgram',  homepage: 'https://status.deepgram.com',         group: 'Transcribers' },
  { name: 'Google Cloud', url: 'https://status.cloud.google.com/incidents.json',             type: 'googlecloud', icon: 'google',    homepage: 'https://status.cloud.google.com',     group: 'Transcribers' },
  // Voice
  { name: 'ElevenLabs',   url: 'https://status.elevenlabs.io/api/v2/summary.json',           type: 'statuspage',  icon: 'elevenlabs', homepage: 'https://status.elevenlabs.io',       group: 'Voice' },
  { name: 'Cartesia',     url: 'https://status.cartesia.ai/api/v2/summary.json',             type: 'statuspage',  icon: 'cartesia',  homepage: 'https://status.cartesia.ai',          group: 'Voice' },
  // Infrastructure
  { name: 'Vapi',         url: 'https://status.vapi.ai/',                                    type: 'betterstack', icon: 'vapi',      homepage: 'https://status.vapi.ai',              group: 'Infrastructure' },
  { name: 'Make',         url: 'https://status.make.com/api/v2/summary.json',                type: 'statuspage',  icon: 'make',      homepage: 'https://status.make.com',             group: 'Infrastructure' },
  { name: 'AWS S3',       url: AWS_HEALTH_URL,                                               type: 'aws-s3',      icon: 'aws',       homepage: 'https://health.aws.amazon.com',       group: 'Infrastructure' },
  { name: 'Twilio',       url: 'https://status.twilio.com/api/v2/summary.json',              type: 'statuspage',  icon: 'twilio',    homepage: 'https://status.twilio.com',           group: 'Infrastructure' },
  { name: 'Cloudflare',   url: 'https://www.cloudflarestatus.com/api/v2/summary.json',       type: 'statuspage',  icon: 'cloudflare', homepage: 'https://www.cloudflarestatus.com',  group: 'Infrastructure' },
  { name: 'Azure',        url: 'https://rssfeed.azure.status.microsoft/en-us/status/feed/', type: 'azure-rss',   icon: 'azure',     homepage: 'https://azure.status.microsoft',      group: 'Infrastructure' },
];

function normalizeStatuspage(data, service) {
  const { status, components = [], incidents = [] } = data;
  return {
    name: service.name,
    icon: service.icon,
    homepage: service.homepage,
    group: service.group,
    status: status.indicator,
    description: status.description,
    components: components.filter(c => !c.group).slice(0, 25).map(c => ({ name: c.name, status: c.status })),
    incidents: incidents.slice(0, 5).map(i => ({
      name: i.name,
      impact: i.impact,
      shortlink: i.shortlink,
    })),
  };
}

function normalizeBetterStack(html, service) {
  const statusMap = { Operational: 'none', Degraded: 'minor', 'Partial Outage': 'major', Outage: 'critical', Maintenance: 'none' };
  const compStatusMap = { Operational: 'operational', Degraded: 'degraded_performance', 'Partial Outage': 'partial_outage', Outage: 'major_outage', Maintenance: 'under_maintenance' };

  const overallMatch = html.match(/badge p-1 pr-2 rounded-full[\s\S]{0,300}?aria-label="([^"]+)"/);
  const overallLabel = overallMatch ? overallMatch[1] : 'Unknown';

  const components = [];
  const compRegex = /class="mr-1 shrink-0"[^>]+aria-label="([^"]+)"[\s\S]{0,200}?shrink truncate'>([^<]+)<\/div>/g;
  let match;
  while ((match = compRegex.exec(html)) !== null) {
    components.push({ name: match[2].trim(), status: compStatusMap[match[1]] || match[1].toLowerCase() });
  }

  return {
    name: service.name,
    icon: service.icon,
    homepage: service.homepage,
    group: service.group,
    status: statusMap[overallLabel] ?? 'unknown',
    description: overallLabel === 'Operational' ? 'All systems operational' : overallLabel,
    components: components.slice(0, 12),
    incidents: [],
  };
}

function normalizeAWSHealth(data, service, s3Only = false) {
  let events = Array.isArray(data) ? data : [];
  if (s3Only) {
    events = events.filter(e =>
      (e.service && e.service.toLowerCase().startsWith('s3')) ||
      (e.service_name && e.service_name.includes('S3'))
    );
  }
  return {
    name: service.name,
    icon: service.icon,
    homepage: service.homepage,
    group: service.group,
    status: events.length > 0 ? 'minor' : 'none',
    description: events.length > 0 ? `${events.length} active event(s)` : 'Service is operating normally',
    components: [],
    incidents: events.slice(0, 5).map(e => ({
      name: `[${e.region_name || 'Global'}] ${e.service_name || 'AWS'}: ${e.summary || ''}`.trim(),
      impact: 'minor',
      shortlink: null,
    })),
  };
}

function normalizeGoogleCloud(data, service) {
  const all = Array.isArray(data) ? data : [];
  const active = all.filter(inc =>
    Array.isArray(inc.currently_affected_locations) && inc.currently_affected_locations.length > 0
  );
  const hasOutage = active.some(i => i.status_impact === 'SERVICE_OUTAGE');
  return {
    name: service.name,
    icon: service.icon,
    homepage: service.homepage,
    group: service.group,
    status: active.length === 0 ? 'none' : hasOutage ? 'major' : 'minor',
    description: active.length === 0 ? 'All systems operational' : `${active.length} active incident(s)`,
    components: [],
    incidents: active.slice(0, 5).map(inc => ({
      name: inc.external_desc || `${inc.service_name} incident`,
      impact: inc.status_impact === 'SERVICE_OUTAGE' ? 'major' : 'minor',
      shortlink: inc.uri ? `https://status.cloud.google.com${inc.uri}` : null,
    })),
  };
}

// xml is the raw RSS XML string from Azure's feed — 0 items means all clear
function normalizeAzureRSS(xml, service) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const titleMatch = m[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    items.push({
      name: titleMatch ? titleMatch[1].trim() : 'Azure service issue',
      impact: 'minor',
      shortlink: null,
    });
  }
  return {
    name: service.name,
    icon: service.icon,
    homepage: service.homepage,
    group: service.group,
    status: items.length > 0 ? 'minor' : 'none',
    description: items.length > 0 ? `${items.length} active issue(s)` : 'All systems operational',
    components: [],
    incidents: items.slice(0, 5),
  };
}

app.get('/api/status', async (req, res) => {
  const settled = await Promise.allSettled(
    SERVICES.map(async (service) => {
      const resp = await axios.get(service.url, {
        timeout: 12000,
        headers: {
          Accept: service.type === 'azure-rss'
            ? 'application/rss+xml, application/xml, text/xml, */*'
            : 'application/json',
          'User-Agent': 'status-dashboard/1.0',
        },
      });
      if (service.type === 'aws-s3')      return normalizeAWSHealth(resp.data, service, true);
      if (service.type === 'googlecloud')  return normalizeGoogleCloud(resp.data, service);
      if (service.type === 'azure-rss')    return normalizeAzureRSS(resp.data, service);
      if (service.type === 'betterstack')  return normalizeBetterStack(resp.data, service);
      return normalizeStatuspage(resp.data, service);
    })
  );

  const services = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: SERVICES[i].name,
      icon: SERVICES[i].icon,
      homepage: SERVICES[i].homepage,
      group: SERVICES[i].group,
      status: 'unknown',
      description: 'Unable to fetch status',
      components: [],
      incidents: [],
      error: r.reason?.message,
    };
  });

  res.json({ updated: new Date().toISOString(), services });
});

app.listen(PORT, () => {
  console.log(`\n  Status dashboard → http://localhost:${PORT}\n`);
});
