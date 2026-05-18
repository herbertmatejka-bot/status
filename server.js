const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const SERVICES = [
  { name: 'Vapi',        url: 'https://status.vapi.ai/',                                 type: 'betterstack', icon: 'vapi',       homepage: 'https://status.vapi.ai' },
  { name: 'Deepgram',    url: 'https://status.deepgram.com/api/v2/summary.json',          type: 'statuspage', icon: 'deepgram',    homepage: 'https://status.deepgram.com' },
  { name: 'ElevenLabs',  url: 'https://status.elevenlabs.io/api/v2/summary.json',         type: 'statuspage', icon: 'elevenlabs',  homepage: 'https://status.elevenlabs.io' },
  { name: 'OpenAI',      url: 'https://status.openai.com/api/v2/summary.json',            type: 'statuspage', icon: 'openai',      homepage: 'https://status.openai.com' },
  { name: 'Twilio',      url: 'https://status.twilio.com/api/v2/summary.json',            type: 'statuspage', icon: 'twilio',      homepage: 'https://status.twilio.com' },
  { name: 'Cloudflare',  url: 'https://www.cloudflarestatus.com/api/v2/summary.json',     type: 'statuspage', icon: 'cloudflare',  homepage: 'https://www.cloudflarestatus.com' },
  { name: 'AWS',         url: 'https://status.aws.amazon.com/data.json',                  type: 'aws',        icon: 'aws',         homepage: 'https://status.aws.amazon.com' },
];

function normalizeStatuspage(data, service) {
  const { status, components = [], incidents = [] } = data;
  return {
    name: service.name,
    icon: service.icon,
    homepage: service.homepage,
    status: status.indicator,        // none | minor | major | critical
    description: status.description,
    components: components.slice(0, 12).map(c => ({ name: c.name, status: c.status })),
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
    status: statusMap[overallLabel] ?? 'unknown',
    description: overallLabel === 'Operational' ? 'All systems operational' : overallLabel,
    components: components.slice(0, 12),
    incidents: [],
  };
}

function normalizeAWS(data, service) {
  const current = data.current || {};
  const allIssues = Object.values(current).flat();
  const hasIssues = allIssues.length > 0;
  return {
    name: service.name,
    icon: service.icon,
    homepage: service.homepage,
    status: hasIssues ? 'minor' : 'none',
    description: hasIssues ? 'Some services may be affected' : 'Service is operating normally',
    components: [],
    incidents: allIssues.slice(0, 5).map(i => ({
      name: `${i.service_name}: ${i.summary}`,
      impact: 'minor',
      shortlink: null,
    })),
  };
}

app.get('/api/status', async (req, res) => {
  const settled = await Promise.allSettled(
    SERVICES.map(async (service) => {
      const resp = await axios.get(service.url, {
        timeout: 12000,
        headers: { Accept: 'application/json', 'User-Agent': 'status-dashboard/1.0' },
      });
      if (service.type === 'aws') return normalizeAWS(resp.data, service);
      if (service.type === 'betterstack') return normalizeBetterStack(resp.data, service);
      return normalizeStatuspage(resp.data, service);
    })
  );

  const services = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: SERVICES[i].name,
      icon: SERVICES[i].icon,
      homepage: SERVICES[i].homepage,
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
