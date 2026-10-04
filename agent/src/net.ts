import dns from 'node:dns';

// Venue networks often advertise IPv6 that goes nowhere; Node would wait on it before falling back.
dns.setDefaultResultOrder('ipv4first');
