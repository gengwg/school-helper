import '../net.js';
import { Mastra } from '@mastra/core/mastra';
import { chatRoute } from '@mastra/ai-sdk';
import { extractor, schoolAgent } from './agents/school.js';
import { whatsappVerify, whatsappInbound } from './routes/whatsapp.js';
import { ingestRoute, weekRoute, syncRoute, appRoute } from './routes/web.js';
import { emailInbound } from './routes/email.js';
import { startHeartbeat } from '../sync.js';

export const mastra = new Mastra({
  agents: { extractor, schoolAgent },
  server: {
    cors: { origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] },
    apiRoutes: [chatRoute({ path: '/chat/:agentId' }), whatsappVerify, whatsappInbound, ingestRoute, weekRoute, syncRoute, appRoute, emailInbound],
  },
});

startHeartbeat(mastra);
