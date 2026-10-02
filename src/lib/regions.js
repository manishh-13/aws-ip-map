// Display names for region codes. Codes that appear in ip-ranges.json before AWS
// publishes a name are shown as "not yet announced" rather than guessed.
export const REGION_NAMES = {
  'af-south-1': ['Africa', 'Cape Town'],
  'ap-east-1': ['Asia Pacific', 'Hong Kong'],
  'ap-east-2': ['Asia Pacific', 'Taipei'],
  'ap-northeast-1': ['Asia Pacific', 'Tokyo'],
  'ap-northeast-2': ['Asia Pacific', 'Seoul'],
  'ap-northeast-3': ['Asia Pacific', 'Osaka'],
  'ap-south-1': ['Asia Pacific', 'Mumbai'],
  'ap-south-2': ['Asia Pacific', 'Hyderabad'],
  'ap-southeast-1': ['Asia Pacific', 'Singapore'],
  'ap-southeast-2': ['Asia Pacific', 'Sydney'],
  'ap-southeast-3': ['Asia Pacific', 'Jakarta'],
  'ap-southeast-4': ['Asia Pacific', 'Melbourne'],
  'ap-southeast-5': ['Asia Pacific', 'Malaysia'],
  'ap-southeast-6': ['Asia Pacific', 'New Zealand'],
  'ap-southeast-7': ['Asia Pacific', 'Thailand'],
  'ca-central-1': ['Canada', 'Central'],
  'ca-west-1': ['Canada West', 'Calgary'],
  'cn-north-1': ['China', 'Beijing'],
  'cn-northwest-1': ['China', 'Ningxia'],
  'eu-central-1': ['Europe', 'Frankfurt'],
  'eu-central-2': ['Europe', 'Zurich'],
  'eu-north-1': ['Europe', 'Stockholm'],
  'eu-south-1': ['Europe', 'Milan'],
  'eu-south-2': ['Europe', 'Spain'],
  'eu-west-1': ['Europe', 'Ireland'],
  'eu-west-2': ['Europe', 'London'],
  'eu-west-3': ['Europe', 'Paris'],
  'eusc-de-east-1': ['AWS European Sovereign Cloud', 'Germany'],
  'il-central-1': ['Israel', 'Tel Aviv'],
  'me-central-1': ['Middle East', 'UAE'],
  'me-south-1': ['Middle East', 'Bahrain'],
  'mx-central-1': ['Mexico', 'Central'],
  'sa-east-1': ['South America', 'São Paulo'],
  'us-east-1': ['US East', 'N. Virginia'],
  'us-east-2': ['US East', 'Ohio'],
  'us-gov-east-1': ['AWS GovCloud', 'US-East'],
  'us-gov-west-1': ['AWS GovCloud', 'US-West'],
  'us-west-1': ['US West', 'N. California'],
  'us-west-2': ['US West', 'Oregon'],
  GLOBAL: ['Global', 'edge and anycast'],
};

export const GEOS = [
  { id: 'na', label: 'North America', hue: 250 },
  { id: 'sa', label: 'South America', hue: 150 },
  { id: 'eu', label: 'Europe', hue: 300 },
  { id: 'mea', label: 'Middle East and Africa', hue: 75 },
  { id: 'ap', label: 'Asia Pacific', hue: 30 },
  { id: 'cn', label: 'China', hue: 5 },
  { id: 'gov', label: 'GovCloud', hue: 220 },
  { id: 'global', label: 'Global', hue: 190 },
];

export function geoOf(code) {
  if (code === 'GLOBAL') return 'global';
  if (code.startsWith('us-gov')) return 'gov';
  if (/^(us|ca|mx)-/.test(code)) return 'na';
  if (code.startsWith('sa-')) return 'sa';
  if (/^eu/.test(code)) return 'eu';
  if (/^(me|af|il)-/.test(code)) return 'mea';
  if (code.startsWith('cn-')) return 'cn';
  if (code.startsWith('ap-')) return 'ap';
  return 'global';
}

export function regionLabel(code) {
  const n = REGION_NAMES[code];
  if (!n) return { code, name: 'Not yet announced', full: `${code} (name not yet published by AWS)`, announced: false };
  return { code, name: `${n[0]} (${n[1]})`, full: `${n[0]} (${n[1]}) ${code}`, announced: true };
}

export const SERVICE_NAMES = {
  AMAZON: 'All AWS (superset)',
  AMAZON_APPFLOW: 'Amazon AppFlow',
  AMAZON_CONNECT: 'Amazon Connect',
  API_GATEWAY: 'Amazon API Gateway (egress)',
  AURORA_DSQL: 'Amazon Aurora DSQL',
  CHIME_MEETINGS: 'Amazon Chime Meetings',
  CHIME_VOICECONNECTOR: 'Amazon Chime Voice Connector',
  CLOUD9: 'AWS Cloud9',
  CLOUDFRONT: 'Amazon CloudFront',
  CLOUDFRONT_ORIGIN_FACING: 'CloudFront origin-facing',
  CODEBUILD: 'AWS CodeBuild',
  DYNAMODB: 'Amazon DynamoDB',
  EBS: 'Amazon EBS',
  EC2: 'Amazon EC2',
  EC2_INSTANCE_CONNECT: 'EC2 Instance Connect',
  EFS: 'Amazon EFS',
  GLOBALACCELERATOR: 'AWS Global Accelerator',
  IVS_LOW_LATENCY: 'Amazon IVS low-latency',
  IVS_REALTIME: 'Amazon IVS real-time',
  KINESIS_VIDEO_STREAMS: 'Kinesis Video Streams',
  MEDIA_PACKAGE_V2: 'AWS Elemental MediaPackage v2',
  ROUTE53: 'Amazon Route 53',
  ROUTE53_HEALTHCHECKS: 'Route 53 health checks',
  ROUTE53_HEALTHCHECKS_PUBLISHING: 'Route 53 health check publishing',
  ROUTE53_RESOLVER: 'Route 53 Resolver',
  S3: 'Amazon S3',
  WORKSPACES_GATEWAYS: 'WorkSpaces gateways',
};

export const serviceLabel = (s) => SERVICE_NAMES[s] || s;
export const slug = (s) => s.toLowerCase().replace(/_/g, '-');
