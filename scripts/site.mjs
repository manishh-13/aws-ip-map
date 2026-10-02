// Site configuration. Override with env vars when forking.
export const SITE = {
  name: 'AWS RangeFinder',
  url: (process.env.SITE_URL || 'https://manishh-13.github.io/aws-rangefinder').replace(/\/$/, ''),
  base: process.env.BASE_PATH || '/aws-rangefinder/',
  repo: process.env.REPO_URL || 'https://github.com/manishh-13/aws-rangefinder',
  source: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
  docs: 'https://docs.aws.amazon.com/vpc/latest/userguide/aws-ip-ranges.html',
  syntaxDocs: 'https://docs.aws.amazon.com/vpc/latest/userguide/aws-ip-syntax.html',
  snsDocs: 'https://docs.aws.amazon.com/vpc/latest/userguide/subscribe-notifications.html',
  snsTopic: 'arn:aws:sns:us-east-1:806199016981:AmazonIpSpaceChanged',
};
