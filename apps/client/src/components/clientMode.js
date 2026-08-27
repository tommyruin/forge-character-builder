const TRUE_FLAG = 'true';

export function isExplicitDevelopmentMode(env = {}) {
  return env?.VITE_FCB_DEVELOPMENT_MODE === TRUE_FLAG;
}

export function isPublicRelease(env = {}) {
  return env?.VITE_PUBLIC_RELEASE === TRUE_FLAG;
}
