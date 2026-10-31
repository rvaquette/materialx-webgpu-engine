(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];function t(e,t){let n=Array(16);for(let r=0;r<4;r++)for(let i=0;i<4;i++){let a=0;for(let n=0;n<4;n++)a+=e[n*4+i]*t[r*4+n];n[r*4+i]=a}return n}function n(e,t){return[e[0]*t[0]+e[4]*t[1]+e[8]*t[2]+e[12],e[1]*t[0]+e[5]*t[1]+e[9]*t[2]+e[13],e[2]*t[0]+e[6]*t[1]+e[10]*t[2]+e[14]]}function r(e,t){return[e[0]*t[0]+e[4]*t[1]+e[8]*t[2],e[1]*t[0]+e[5]*t[1]+e[9]*t[2],e[2]*t[0]+e[6]*t[1]+e[10]*t[2]]}function i(e){return Array.isArray(e)?e.map(e=>Number(e)):typeof e==`number`?[e]:[]}function a(e,t,n){return[1,0,0,0,0,1,0,0,0,0,1,0,e,t,n,1]}function o(e,t,n){return[e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1]}function s(e,t){let n=t*Math.PI/180,r=Math.cos(n),i=Math.sin(n);return e===0?[1,0,0,0,0,r,i,0,0,-i,r,0,0,0,0,1]:e===1?[r,0,-i,0,0,1,0,0,i,0,r,0,0,0,0,1]:[r,i,0,0,-i,r,0,0,0,0,1,0,0,0,0,1]}function c(e,t,n,r){let i=t*t,a=n*n,o=r*r;return[1-2*(a+o),2*(t*n+r*e),2*(t*r-n*e),0,2*(t*n-r*e),1-2*(i+o),2*(n*r+t*e),0,2*(t*r+n*e),2*(n*r-t*e),1-2*(i+a),0,0,0,0,1]}function l(t){let n=Array(16);n[0]=t[5]*t[10]*t[15]-t[5]*t[11]*t[14]-t[9]*t[6]*t[15]+t[9]*t[7]*t[14]+t[13]*t[6]*t[11]-t[13]*t[7]*t[10],n[4]=-t[4]*t[10]*t[15]+t[4]*t[11]*t[14]+t[8]*t[6]*t[15]-t[8]*t[7]*t[14]-t[12]*t[6]*t[11]+t[12]*t[7]*t[10],n[8]=t[4]*t[9]*t[15]-t[4]*t[11]*t[13]-t[8]*t[5]*t[15]+t[8]*t[7]*t[13]+t[12]*t[5]*t[11]-t[12]*t[7]*t[9],n[12]=-t[4]*t[9]*t[14]+t[4]*t[10]*t[13]+t[8]*t[5]*t[14]-t[8]*t[6]*t[13]-t[12]*t[5]*t[10]+t[12]*t[6]*t[9],n[1]=-t[1]*t[10]*t[15]+t[1]*t[11]*t[14]+t[9]*t[2]*t[15]-t[9]*t[3]*t[14]-t[13]*t[2]*t[11]+t[13]*t[3]*t[10],n[5]=t[0]*t[10]*t[15]-t[0]*t[11]*t[14]-t[8]*t[2]*t[15]+t[8]*t[3]*t[14]+t[12]*t[2]*t[11]-t[12]*t[3]*t[10],n[9]=-t[0]*t[9]*t[15]+t[0]*t[11]*t[13]+t[8]*t[1]*t[15]-t[8]*t[3]*t[13]-t[12]*t[1]*t[11]+t[12]*t[3]*t[9],n[13]=t[0]*t[9]*t[14]-t[0]*t[10]*t[13]-t[8]*t[1]*t[14]+t[8]*t[2]*t[13]+t[12]*t[1]*t[10]-t[12]*t[2]*t[9],n[2]=t[1]*t[6]*t[15]-t[1]*t[7]*t[14]-t[5]*t[2]*t[15]+t[5]*t[3]*t[14]+t[13]*t[2]*t[7]-t[13]*t[3]*t[6],n[6]=-t[0]*t[6]*t[15]+t[0]*t[7]*t[14]+t[4]*t[2]*t[15]-t[4]*t[3]*t[14]-t[12]*t[2]*t[7]+t[12]*t[3]*t[6],n[10]=t[0]*t[5]*t[15]-t[0]*t[7]*t[13]-t[4]*t[1]*t[15]+t[4]*t[3]*t[13]+t[12]*t[1]*t[7]-t[12]*t[3]*t[5],n[14]=-t[0]*t[5]*t[14]+t[0]*t[6]*t[13]+t[4]*t[1]*t[14]-t[4]*t[2]*t[13]-t[12]*t[1]*t[6]+t[12]*t[2]*t[5],n[3]=-t[1]*t[6]*t[11]+t[1]*t[7]*t[10]+t[5]*t[2]*t[11]-t[5]*t[3]*t[10]-t[9]*t[2]*t[7]+t[9]*t[3]*t[6],n[7]=t[0]*t[6]*t[11]-t[0]*t[7]*t[10]-t[4]*t[2]*t[11]+t[4]*t[3]*t[10]+t[8]*t[2]*t[7]-t[8]*t[3]*t[6],n[11]=-t[0]*t[5]*t[11]+t[0]*t[7]*t[9]+t[4]*t[1]*t[11]-t[4]*t[3]*t[9]-t[8]*t[1]*t[7]+t[8]*t[3]*t[5],n[15]=t[0]*t[5]*t[10]-t[0]*t[6]*t[9]-t[4]*t[1]*t[10]+t[4]*t[2]*t[9]+t[8]*t[1]*t[6]-t[8]*t[2]*t[5];let r=t[0]*n[0]+t[1]*n[4]+t[2]*n[8]+t[3]*n[12];return r===0?e:(r=1/r,n.map(e=>e*r))}function u(n,r){let u=n.op,d=i(n.value),f;if(u.includes(`transform`))f=d.length>=16?d.slice(0,16):e;else if(u.includes(`translate`))f=a(d[0]??0,d[1]??0,d[2]??0);else if(u.includes(`scale`)){let e=d.length===1?[d[0],d[0],d[0]]:d;f=o(e[0]??1,e[1]??1,e[2]??1)}else u.includes(`orient`)?f=c(d[0]??1,d[1]??0,d[2]??0,d[3]??0):u.includes(`rotateXYZ`)||u.includes(`rotateXZY`)||u.includes(`rotateZYX`)?f=t(s(0,d[0]??0),t(s(1,d[1]??0),s(2,d[2]??0))):u.includes(`rotateX`)?f=s(0,d[0]??0):u.includes(`rotateY`)?f=s(1,d[0]??0):u.includes(`rotateZ`)?f=s(2,d[0]??0):(r?.({level:`warning`,message:`Unsupported xformOp ${u}`,detail:n.typeName}),f=e);return n.invert?l(f):f}function d(n,r){let i=e;for(let e of n)i=t(i,u(e,r));return i}function f(n,r){let i=new Map,a=(e,o)=>{let s=n.prims.get(e);if(!s)return;let c=t(o,d(s.xformOps,r));i.set(e,c);for(let e of s.children)a(e,c)};for(let t of n.roots)a(t,e);return i}function p(e,t,n,r){let i=1/Math.tan(e/2);return[i/t,0,0,0,0,i,0,0,0,0,r/(n-r),-1,0,0,n*r/(n-r),0]}function m(e,t,n,r,i,a){return[2/(t-e),0,0,0,0,2/(r-n),0,0,0,0,1/(i-a),0,-(t+e)/(t-e),-(r+n)/(r-n),i/(i-a),1]}function h(e,t,n){let r=t[0]-e[0],i=t[1]-e[1],a=t[2]-e[2],o=Math.hypot(r,i,a)||1,s=[r/o,i/o,a/o],c=s[1]*n[2]-s[2]*n[1],l=s[2]*n[0]-s[0]*n[2],u=s[0]*n[1]-s[1]*n[0],d=Math.hypot(c,l,u)||1;c/=d,l/=d,u/=d;let f=l*s[2]-u*s[1],p=u*s[0]-c*s[2],m=c*s[1]-l*s[0];return[c,f,-s[0],0,l,p,-s[1],0,u,m,-s[2],0,-(c*e[0]+l*e[1]+u*e[2]),-(f*e[0]+p*e[1]+m*e[2]),s[0]*e[0]+s[1]*e[1]+s[2]*e[2],1]}var g=1e-4,_=(e,t,n)=>Number.isFinite(e)?Math.min(Math.max(e,t),n):t;function v(e,t){let n=_(e,0,80),r=_(t,0,1);return[n*(.419*(1-r)+.187*r),n*(.697*(1-r)+.4*r),n*(1.37*(1-r)+1.05*r)]}function y(e,t){let n=_(t,0,1),r=5.969-.215*n+2.532*n**2-10.73*n**3+5.574*n**4+.245*n**5,i=Math.max(r,g);return[(Math.log(Math.max(_(e[0],0,1),1e-6))/i)**2,(Math.log(Math.max(_(e[1],0,1),1e-6))/i)**2,(Math.log(Math.max(_(e[2],0,1),1e-6))/i)**2]}var b=`
fn mx_hair_clamp(x: f32, lo: f32, hi: f32) -> f32 { return min(max(x, lo), hi); }
fn mx_hair_log_i0(value: f32) -> f32 {
  let x = abs(value);
  if (x > 12.0) {
    let r = 1.0 / x;
    let r2 = r * r;
    return x - 0.5 * log(6.283185307179586 * x) +
      log(1.0 + r / 8.0 + 9.0 * r2 / 128.0 + 225.0 * r2 * r / 3072.0 + 11025.0 * r2 * r2 / 98304.0);
  }
  var term = 1.0;
  var total = 1.0;
  for (var k = 1u; k <= 32u; k++) {
    let fk = f32(k);
    term *= x * x / (4.0 * fk * fk);
    total += term;
  }
  return log(total);
}
fn mx_hair_log_sinh(x: f32) -> f32 {
  if (x > 20.0) { return x - 0.6931471805599453 + log(max(1.0 - exp(-2.0 * x), 1.0e-30)); }
  if (x < 0.001) { return log(x) + log(1.0 + x * x / 6.0 + x * x * x * x / 120.0); }
  return log(max(0.5 * (exp(x) - exp(-x)), 1.0e-30));
}
fn mx_hair_m(sinI: f32, cosI: f32, sinOp: f32, cosOp: f32, variance: f32) -> f32 {
  let v = max(variance, 1.0e-5);
  let inv = 1.0 / v;
  let logM = -sinI * sinOp * inv + mx_hair_log_i0(cosI * cosOp * inv) -
    log(2.0 * v) - mx_hair_log_sinh(inv);
  return exp(min(logM, 80.0));
}
fn mx_hair_wrap(x: f32) -> f32 { return x - 6.283185307179586 * floor((x + 3.141592653589793) / 6.283185307179586); }
fn mx_hair_logistic_cdf(x: f32, scale: f32) -> f32 { return 1.0 / (1.0 + exp(mx_hair_clamp(-x / scale, -80.0, 80.0))); }
fn mx_hair_n(delta: f32, scale: f32) -> f32 {
  let d = mx_hair_wrap(delta);
  let e = exp(-abs(d) / scale);
  let norm = mx_hair_logistic_cdf(3.141592653589793, scale) - mx_hair_logistic_cdf(-3.141592653589793, scale);
  return e / (scale * (1.0 + e) * (1.0 + e) * norm);
}
fn mx_hair_fresnel(cosIncident: f32, eta: f32) -> f32 {
  let ci = mx_hair_clamp(abs(cosIncident), 0.0, 1.0);
  let sinT2 = (1.0 - ci * ci) / (eta * eta);
  if (sinT2 >= 1.0) { return 1.0; }
  let ct = sqrt(max(1.0 - sinT2, 0.0));
  let rs = (eta * ci - ct) / (eta * ci + ct);
  let rp = (ci - eta * ct) / (ci + eta * ct);
  return mx_hair_clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}
fn mx_hair_center(order: u32, gammaO: f32, gammaT: f32) -> f32 { return 2.0 * f32(order) * gammaT - 2.0 * gammaO + f32(order) * 3.141592653589793; }
fn mx_hair_luminance(color: vec3f) -> f32 { return dot(color, vec3f(0.2722287, 0.6740818, 0.0536895)); }
fn mx_hair_eval(lobe: MxBsdfLobe, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let woLen = length(wo);
  let wiLen = length(wi);
  if (woLen < 1.0e-20 || wiLen < 1.0e-20) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wO = wo / woLen;
  let wI = wi / wiLen;
  let thetaO = asin(mx_hair_clamp(wO.x, -1.0, 1.0));
  let thetaI = asin(mx_hair_clamp(wI.x, -1.0, 1.0));
  let radialO = length(wO.yz);
  var gammaO = 0.0;
  if (radialO > 1.0e-8) { gammaO = asin(mx_hair_clamp(wO.y / radialO, -1.0, 1.0)); }
  let h = sin(gammaO);
  let eta = mx_hair_clamp(lobe.ior, 1.0001, 3.0);
  let cosThetaO = max(abs(cos(thetaO)), 1.0e-5);
  let etaPrime = sqrt(max(eta * eta - sin(thetaO) * sin(thetaO), 1.0e-8)) / cosThetaO;
  let gammaT = asin(mx_hair_clamp(h / etaPrime, -0.999999, 0.999999));
  let cosGammaT = max(cos(gammaT), 1.0e-5);
  let sinThetaT = mx_hair_clamp(sin(thetaO) / etaPrime, -0.999999, 0.999999);
  let cosThetaT = max(sqrt(max(1.0 - sinThetaT * sinThetaT, 0.0)), 1.0e-5);
  let f = mx_hair_fresnel(cosThetaO * cos(gammaO), eta);
  let pathT = exp(-clamp(lobe.extinction, vec3f(0.0), vec3f(80.0)) * (2.0 * cosGammaT / cosThetaT));
  let betaM = mx_hair_clamp(lobe.roughness, 0.0, 1.0);
  let betaN = mx_hair_clamp(lobe.anisotropy, 0.0, 1.0);
  let v0 = max(pow(0.726 * betaM + 0.812 * betaM * betaM + 3.7 * pow(betaM, 20.0), 2.0), 1.0e-5);
  let azScale = max(sqrt(3.141592653589793 / 8.0) * (0.265 * betaN + 1.194 * betaN * betaN + 5.372 * pow(betaN, 22.0)), 1.0e-4);
  let angle = mx_hair_clamp(lobe.rotation, -80.0, 80.0) * 0.017453292519943295;
  let vars = vec4f(v0, max(0.25 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5));
  let offs = vec4f(-2.0 * angle, angle, 4.0 * angle, 0.0);
  let a0 = vec3f(f) * clamp(lobe.color, vec3f(0.0), vec3f(1.0));
  let a1 = pow(vec3f(1.0 - f), vec3f(2.0)) * pathT * clamp(lobe.color90, vec3f(0.0), vec3f(1.0));
  let a2 = pow(vec3f(1.0 - f), vec3f(2.0)) * f * pathT * pathT * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let q = vec3f(f) * pathT;
  let a3 = pow(vec3f(1.0 - f), vec3f(2.0)) * vec3f(f * f) * pathT * pathT * pathT /
    max(vec3f(1.0) - q, vec3f(1.0e-8)) * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let weights = vec4f(mx_hair_luminance(a0), mx_hair_luminance(a1), mx_hair_luminance(a2), mx_hair_luminance(a3));
  let total = dot(weights, vec4f(1.0));
  if (total <= 1.0e-12) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let sinI = sin(thetaI);
  let cosI = abs(cos(thetaI));
  let sinO = sin(thetaO);
  let cosO = abs(cos(thetaO));
  let phiO = atan2(wO.y, wO.z);
  let phiI = atan2(wI.y, wI.z);
  var result = vec3f(0.0);
  var pdf = 0.0;
  for (var order = 0u; order < 4u; order++) {
    let thetaOp = thetaO + offs[order];
    let mPdf = mx_hair_m(sinI, cosI, sin(thetaOp), abs(cos(thetaOp)), vars[order]);
    var nPdf = mx_hair_n(phiI - phiO - mx_hair_center(order, gammaO, gammaT), azScale);
    var color = a0;
    if (order == 1u) { color = a1; }
    if (order == 2u) { color = a2; }
    if (order == 3u) { color = a3; nPdf = 0.15915494309189535; }
    let density = mPdf * nPdf;
    result += color * density;
    pdf += weights[order] / total * density;
  }
  return MxBsdfEval(result / max(abs(wI.z), 1.0e-6), pdf);
}
fn mx_hair_sample(lobe: MxBsdfLobe, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let woLen = length(wo);
  if (woLen < 1.0e-20) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wO = wo / woLen;
  let thetaO = asin(mx_hair_clamp(wO.x, -1.0, 1.0));
  let radialO = length(wO.yz);
  var gammaO = 0.0;
  if (radialO > 1.0e-8) { gammaO = asin(mx_hair_clamp(wO.y / radialO, -1.0, 1.0)); }
  let h = sin(gammaO);
  let eta = mx_hair_clamp(lobe.ior, 1.0001, 3.0);
  let cosThetaO = max(abs(cos(thetaO)), 1.0e-5);
  let etaPrime = sqrt(max(eta * eta - sin(thetaO) * sin(thetaO), 1.0e-8)) / cosThetaO;
  let gammaT = asin(mx_hair_clamp(h / etaPrime, -0.999999, 0.999999));
  let cosGammaT = max(cos(gammaT), 1.0e-5);
  let sinThetaT = mx_hair_clamp(sin(thetaO) / etaPrime, -0.999999, 0.999999);
  let cosThetaT = max(sqrt(max(1.0 - sinThetaT * sinThetaT, 0.0)), 1.0e-5);
  let f = mx_hair_fresnel(cosThetaO * cos(gammaO), eta);
  let pathT = exp(-clamp(lobe.extinction, vec3f(0.0), vec3f(80.0)) * (2.0 * cosGammaT / cosThetaT));
  let betaM = mx_hair_clamp(lobe.roughness, 0.0, 1.0);
  let betaN = mx_hair_clamp(lobe.anisotropy, 0.0, 1.0);
  let v0 = max(pow(0.726 * betaM + 0.812 * betaM * betaM + 3.7 * pow(betaM, 20.0), 2.0), 1.0e-5);
  let azScale = max(sqrt(3.141592653589793 / 8.0) * (0.265 * betaN + 1.194 * betaN * betaN + 5.372 * pow(betaN, 22.0)), 1.0e-4);
  let angle = mx_hair_clamp(lobe.rotation, -80.0, 80.0) * 0.017453292519943295;
  let vars = vec4f(v0, max(0.25 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5), max(4.0 * v0, 1.0e-5));
  let offs = vec4f(-2.0 * angle, angle, 4.0 * angle, 0.0);
  let a0 = vec3f(f) * clamp(lobe.color, vec3f(0.0), vec3f(1.0));
  let a1 = pow(vec3f(1.0 - f), vec3f(2.0)) * pathT * clamp(lobe.color90, vec3f(0.0), vec3f(1.0));
  let a2 = pow(vec3f(1.0 - f), vec3f(2.0)) * f * pathT * pathT * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let q = vec3f(f) * pathT;
  let a3 = pow(vec3f(1.0 - f), vec3f(2.0)) * vec3f(f * f) * pathT * pathT * pathT /
    max(vec3f(1.0) - q, vec3f(1.0e-8)) * clamp(lobe.hairTintTRT, vec3f(0.0), vec3f(1.0));
  let weights = vec4f(mx_hair_luminance(a0), mx_hair_luminance(a1), mx_hair_luminance(a2), mx_hair_luminance(a3));
  let total = dot(weights, vec4f(1.0));
  if (total <= 1.0e-12) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  var remaining = mx_hair_clamp(u.x, 0.0, 0.99999994) * total;
  var selected = 3u;
  var pathRemainder = 0.0;
  for (var order = 0u; order < 4u; order++) {
    if (remaining <= weights[order]) {
      selected = order;
      pathRemainder = remaining / max(weights[order], 1.0e-30);
      break;
    }
    remaining -= weights[order];
  }
  let thetaOp = thetaO + offs[selected];
  let v = vars[selected];
  let sampleU = mx_hair_clamp(u.y, 1.0e-7, 1.0);
  let cosD = mx_hair_clamp(1.0 + v * log(sampleU + (1.0 - sampleU) * exp(-2.0 / v)), -1.0, 1.0);
  let sinD = sqrt(max(1.0 - cosD * cosD, 0.0));
  let sinI = -cosD * sin(thetaOp) + sinD * cos(6.283185307179586 * pathRemainder) * cos(thetaOp);
  let thetaI = asin(mx_hair_clamp(sinI, -1.0, 1.0));
  let phiO = atan2(wO.y, wO.z);
  var phiI = phiO + mx_hair_center(selected, gammaO, gammaT) + 6.283185307179586 * u.z;
  if (selected < 3u) {
    let low = mx_hair_logistic_cdf(-3.141592653589793, azScale);
    let high = mx_hair_logistic_cdf(3.141592653589793, azScale);
    let prob = mx_hair_clamp(low + mx_hair_clamp(u.z, 0.0, 1.0) * (high - low), 1.0e-7, 0.9999999);
    phiI = phiO + mx_hair_center(selected, gammaO, gammaT) + azScale * log(prob / (1.0 - prob));
  }
  let wi = vec3f(sin(thetaI), cos(thetaI) * sin(phiI), cos(thetaI) * cos(phiI));
  let ev = mx_hair_eval(lobe, wO, wi);
  return MxBsdfSample(wi, ev.value, ev.pdf, ev.pdf > 0.0);
}
fn mx_hair_absorption_melanin(concentration: f32, redness: f32) -> vec3f {
  let amount = mx_hair_clamp(concentration, 0.0, 80.0);
  let red = mx_hair_clamp(redness, 0.0, 1.0);
  return amount * mix(vec3f(0.419, 0.697, 1.37), vec3f(0.187, 0.4, 1.05), red);
}
fn mx_hair_absorption_color(color: vec3f, azimuthalRoughness: f32) -> vec3f {
  let beta = mx_hair_clamp(azimuthalRoughness, 0.0, 1.0);
  let denom = 5.969 - 0.215 * beta + 2.532 * beta * beta - 10.73 * pow(beta, 3.0) +
    5.574 * pow(beta, 4.0) + 0.245 * pow(beta, 5.0);
  let safeColor = max(clamp(color, vec3f(0.0), vec3f(1.0)), vec3f(1.0e-6));
  let logColor = log(safeColor) / max(denom, 1.0e-4);
  return logColor * logColor;
}
`,x=e=>e<0?0:e>1?1:e;function S(e){if(!e)return;let t=e.source;return t.kind===`value`||t.kind==="default"?t.value:void 0}function C(e,t,n){let r=S(e.get(t))?.[0];return r!==void 0&&Number.isFinite(r)?r:n}function w(e,t,n){let r=S(e.get(t));if(r&&r.length>=3)return[r[0]??0,r[1]??0,r[2]??0];if(r&&r.length===1){let e=r[0]??0;return[e,e,e]}return n}function T(e,t){let n={};return e>0&&(n.anisotropy=e),t>0&&(n.rotation=t),n}var E=(e,t)=>[e[0]*t,e[1]*t,e[2]*t],D=(e,t,n)=>[e[0]+(t[0]-e[0])*n,e[1]+(t[1]-e[1])*n,e[2]+(t[2]-e[2])*n];function O(e,t,n){return{lobes:e.filter(e=>e.weight>0),opacity:x(t),...n.coat?{coat:n.coat}:{},...n.sheen?{sheen:n.sheen}:{},...n.fuzz?{fuzz:n.fuzz}:{},...n.thinFilm?{thinFilm:n.thinFilm}:{},...n.emission?{emission:n.emission}:{}}}function k(e){let t=C(e,`base`,1),n=x(C(e,`metalness`,0)),r=x(C(e,`transmission`,0)),i=x(C(e,`specular`,1)),a=x(C(e,`subsurface`,0)),o=C(e,`specular_roughness`,.2),s=C(e,`diffuse_roughness`,0),c=C(e,`specular_anisotropy`,0),l=C(e,`specular_rotation`,0),u=C(e,`specular_IOR`,1.5),d=C(e,`transmission_dispersion`,0),f=w(e,`base_color`,[1,1,1]),p=[x(f[0]),x(f[1]),x(f[2])],m=w(e,`specular_color`,[1,1,1]),h=w(e,`transmission_color`,[1,1,1]),g=w(e,`subsurface_color`,[1,1,1]),_=C(e,`transmission_depth`,0),v=E(w(e,`subsurface_radius`,[1,1,1]),C(e,`subsurface_scale`,1)),y=C(e,`subsurface_anisotropy`,0),b=(1-n)*(1-r),S=T(c,l),D=[{kind:`conductor`,weight:n,color:p,roughness:o,...S},{kind:`dielectric_transmission`,weight:(1-n)*r,color:h,roughness:o,ior:u,...d>0?{dispersion:20/d}:{},..._>0?{attenuationColor:h,attenuationDistance:_}:{}},{kind:`dielectric_reflection`,weight:b*i,color:m,roughness:o,ior:u,...S},{kind:`burley_diffuse`,weight:b*t,color:p,roughness:s},{kind:`subsurface`,weight:b*a,color:g,...a>0?{subsurfaceRadius:v,...y===0?{}:{anisotropy:y}}:{}}],k={},A=x(C(e,`coat`,0));A>0&&(k.coat={weight:A,color:w(e,`coat_color`,[1,1,1]),roughness:C(e,`coat_roughness`,.1),ior:C(e,`coat_IOR`,1.5)});let j=x(C(e,`sheen`,0));j>0&&(k.sheen={weight:j,color:w(e,`sheen_color`,[1,1,1]),roughness:C(e,`sheen_roughness`,.3)});let M=C(e,`thin_film_thickness`,0);M>0&&(k.thinFilm={weight:1,thickness:M,ior:C(e,`thin_film_IOR`,1.5)});let ee=C(e,`emission`,0);ee>0&&(k.emission=E(w(e,`emission_color`,[1,1,1]),ee));let te=w(e,`opacity`,[1,1,1]);return O(D,(te[0]+te[1]+te[2])/3,k)}function A(e){let t=x(C(e,`base_weight`,1)),n=x(C(e,`base_metalness`,0)),r=x(C(e,`specular_weight`,1)),i=x(C(e,`transmission_weight`,0)),a=x(C(e,`subsurface_weight`,0)),o=C(e,`specular_roughness`,.3),s=C(e,`base_diffuse_roughness`,0),c=C(e,`specular_roughness_anisotropy`,0),l=C(e,`specular_ior`,1.5),u=Math.max(C(e,`transmission_dispersion_scale`,0),0)*20/Math.max(C(e,`transmission_dispersion_abbe_number`,20),1e-6),d=w(e,`base_color`,[.8,.8,.8]),f=w(e,`specular_color`,[1,1,1]),p=w(e,`transmission_color`,[1,1,1]),m=w(e,`subsurface_color`,[.8,.8,.8]),h=C(e,`transmission_depth`,0),g=E(w(e,`subsurface_radius_scale`,[1,.5,.25]),C(e,`subsurface_radius`,1)),_=C(e,`subsurface_scatter_anisotropy`,0),v=(1-n)*(1-i),y=C(e,`geometry_thin_walled`,0)>.5,b=y?1-n:v,S=T(c,0),D=[{kind:`conductor`,weight:n,color:d,roughness:o,...S},{kind:`dielectric_transmission`,weight:(1-n)*i,color:p,roughness:o,ior:l,...u>0?{dispersion:u}:{},...y?{thinWalled:!0}:h>0?{attenuationColor:p,attenuationDistance:h}:{}},{kind:`dielectric_reflection`,weight:b*r,color:f,roughness:o,ior:l,...S},{kind:`burley_diffuse`,weight:v*t,color:d,roughness:s},{kind:`subsurface`,weight:v*a,color:m,...a>0?{subsurfaceRadius:g,..._===0?{}:{anisotropy:_}}:{}}],k={},A=x(C(e,`coat_weight`,0));A>0&&(k.coat={weight:A,color:w(e,`coat_color`,[1,1,1]),roughness:C(e,`coat_roughness`,0),ior:C(e,`coat_ior`,1.6)});let j=x(C(e,`fuzz_weight`,0));j>0&&(k.fuzz={weight:j,color:w(e,`fuzz_color`,[1,1,1]),roughness:C(e,`fuzz_roughness`,.5)});let M=x(C(e,`thin_film_weight`,0));M>0&&(k.thinFilm={weight:M,thickness:C(e,`thin_film_thickness`,.5)*1e3,ior:C(e,`thin_film_ior`,1.4)});let ee=C(e,`emission_luminance`,0);return ee>0&&(k.emission=E(w(e,`emission_color`,[1,1,1]),ee)),O(D,C(e,`geometry_opacity`,1),k)}function j(e){let t=x(C(e,`metallic`,1)),n=x(C(e,`transmission`,0)),r=x(C(e,`specular`,1)),i=C(e,`roughness`,1),a=C(e,`ior`,1.5),o=C(e,`anisotropy_strength`,0),s=C(e,`anisotropy_rotation`,0),c=w(e,`base_color`,[1,1,1]),l=w(e,`specular_color`,[1,1,1]),u=(1-t)*(1-n),d=T(o,s),f=[{kind:`conductor`,weight:t,color:c,roughness:i,...d},{kind:`dielectric_transmission`,weight:(1-t)*n,color:c,roughness:i,ior:a},{kind:`dielectric_reflection`,weight:u*r,color:l,roughness:i,ior:a,...d},{kind:`burley_diffuse`,weight:u,color:c,roughness:i}],p={},m=x(C(e,`clearcoat`,0));m>0&&(p.coat={weight:m,color:[1,1,1],roughness:C(e,`clearcoat_roughness`,0),ior:1.5});let h=w(e,`sheen_color`,[0,0,0]),g=Math.max(h[0],h[1],h[2]);g>0&&(p.sheen={weight:g,color:h,roughness:C(e,`sheen_roughness`,0)});let _=x(C(e,`iridescence`,0));_>0&&(p.thinFilm={weight:_,thickness:C(e,`iridescence_thickness`,100),ior:1.3});let v=w(e,`emissive`,[0,0,0]);(v[0]>0||v[1]>0||v[2]>0)&&(p.emission=v);let y=x(C(e,`alpha`,1)),b=C(e,`alpha_mode`,0),S=b===0?1:b===1?Number(y>=C(e,`alpha_cutoff`,.5)):y,E=f.find(e=>e.kind===`dielectric_transmission`),D=Math.max(C(e,`dispersion`,0),0);return E&&D>0&&(E.dispersion=D),O(f,S,p)}function M(e){let t=x(C(e,`metallic`,0)),n=C(e,`roughness`,.5),r=C(e,`ior`,1.5),i=w(e,`diffuseColor`,[.18,.18,.18]),a=C(e,`useSpecularWorkflow`,0)>=.5?w(e,`specularColor`,[0,0,0]):[1,1,1],o=1-t,s=x(C(e,`opacity`,1)),c=C(e,`opacityThreshold`,0),l=c>0?1:s,u=[{kind:`conductor`,weight:t,color:i,roughness:n},{kind:`dielectric_reflection`,weight:o*l,color:a,roughness:n,ior:r},{kind:`dielectric_transmission`,weight:o*(1-l),color:[1,1,1],roughness:n,ior:r},{kind:`burley_diffuse`,weight:o*l,color:i,roughness:n}],d={},f=x(C(e,`clearcoat`,0));f>0&&(d.coat={weight:f,color:[1,1,1],roughness:C(e,`clearcoatRoughness`,.01),ior:1.5});let p=w(e,`emissiveColor`,[0,0,0]);return(p[0]>0||p[1]>0||p[2]>0)&&(d.emission=p),O(u,c>0&&s<c?0:1,d)}function ee(e){let t=x(C(e,`metallic`,0)),n=x(C(e,`specTrans`,0)),r=x(C(e,`specular`,.5)),i=x(C(e,`subsurface`,0)),a=C(e,`roughness`,.5),o=C(e,`anisotropic`,0),s=C(e,`ior`,1.5),c=w(e,`baseColor`,[.16,.16,.16]),l=D([1,1,1],c,x(C(e,`specularTint`,0))),u=(1-t)*(1-n),d=T(o,0),f=[{kind:`conductor`,weight:t,color:c,roughness:a,...d},{kind:`dielectric_transmission`,weight:(1-t)*n,color:c,roughness:a,ior:s},{kind:`dielectric_reflection`,weight:u*r,color:l,roughness:a,ior:s,...d},{kind:`burley_diffuse`,weight:u,color:c,roughness:a},{kind:`subsurface`,weight:u*i,color:c}],p={},m=x(C(e,`sheen`,0));m>0&&(p.sheen={weight:m,color:D([1,1,1],c,x(C(e,`sheenTint`,.5))),roughness:.3});let h=x(C(e,`clearcoat`,0));return h>0&&(p.coat={weight:h,color:[1,1,1],roughness:1-x(C(e,`clearcoatGloss`,1)),ior:1.5}),O(f,1,p)}function te(e){let t=e.inputs;switch(e.family){case`simple_hair`:{let e=C(t,`azimuthalRoughness`,.1),n=y(w(t,`baseColor`,[1,1,1]),e),r=v(C(t,`melaninConcentration`,.5),C(t,`melaninRedness`,.5));return O([{kind:`chiang_hair`,weight:1,color:w(t,`tint_R`,[1,1,1]),color90:w(t,`tint_TT`,[1,1,1]),hairTintTRT:w(t,`tint_TRT`,[1,1,1]),extinction:D(n,r,x(C(t,`melaninMix`,1))),roughness:C(t,`longitudinalRoughness`,.1),anisotropy:e,rotation:C(t,`cuticleAngle`,.5),ior:C(t,`ior`,1.55)}],1,{})}case`standard_surface`:return k(t);case`open_pbr_surface`:return A(t);case`gltf_pbr`:return j(t);case`UsdPreviewSurface`:return M(t);case`disney_principled`:return ee(t)}}var ne={baseColor:[.8,.8,.8],metalness:0,roughness:.5,transmission:0,subsurface:0,ior:1.5,specular:1},re={viewProj:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-2,1],eye:[0,0,2],exposure:0},ie={direction:[.3,.5,.8],color:[1,1,1],intensity:1},ae={radiance:[.03,.03,.03]};function oe(e){let n=t(e.projectionMatrix,e.view),r=e.transform;return{viewProj:n,eye:[r[12]??0,r[13]??0,r[14]??0],exposure:e.exposure??0}}function se(e){let t=e.find(e=>e.type===`distant`)??e.find(e=>e.type!==`dome`);return t?{direction:r(t.transform,[0,0,-1]),color:t.color,intensity:t.intensity*2**t.exposure}:e.some(e=>e.type===`dome`)?{...ie,intensity:0}:ie}function ce(e){let t=e.find(e=>e.type===`dome`);if(!t)return ae;let n=t.intensity*2**t.exposure;return{radiance:[t.color[0]*n,t.color[1]*n,t.color[2]*n]}}function le(e,t){let n=e?.resolvedSurface,r=n?.family===`open_pbr_surface`?`base_metalness`:n?.family===`standard_surface`?`metalness`:`metallic`,i=n?.inputs.get(r)?.source,a=i?.kind===`value`||i?.kind==="default"?i.value[0]:i===void 0?t.metalness:void 0,o=a!==void 0&&a>=1,s=!o&&(e?.features.passes.some(e=>e.kind===`transmission`)??!1),c=n?.family===`gltf_pbr`?`alpha`:n?.family===`open_pbr_surface`?`geometry_opacity`:`opacity`,l=n?.inputs.get(`alpha_mode`)?.source;if(n?.family===`gltf_pbr`&&(l?.kind===`value`||l?.kind==="default")&&l.value[0]===1)return`masked`;let u=n?.inputs.get(c)?.source.kind===`connection`&&(n.family!==`gltf_pbr`||l?.kind!==`value`&&l?.kind!=="default"||l.value[0]!==0),d=n!==void 0&&(u||te(n).opacity<1);return s||d||!o&&t.transmission>0?`transmission`:`opaque`}function ue(e,t={}){let n=t.frameCamera??(t.camera?oe(t.camera):re),r=t.lights??[],i=se(r),a=t.environment??ce(r),o=t.surfaceFor??(()=>ne),s=[],c=[],l=!1,u=!1,d=!1;for(let t of e.instances){if(!t.hasGeometry){c.push(t.id);continue}let n=t.materialKey?e.materials.get(t.materialKey):void 0,r=n?o(n):ne,i=le(n,r);i===`transmission`?d=!0:i===`masked`?u=!0:l=!0,s.push({instanceId:t.id,prototypeId:t.prototypeId,pass:i,model:t.transform,surface:r,...t.materialKey===void 0?{}:{materialKey:t.materialKey}})}let f=[];return l&&f.push(`opaque`),u&&f.push(`masked`),d&&f.push(`transmission`),{camera:n,light:i,environment:a,draws:s,passes:f,skipped:c}}function de(e,t){let n=new Float32Array(92);n.set(t.model,0),n.set(e.camera.viewProj,16),n.set([e.camera.eye[0],e.camera.eye[1],e.camera.eye[2],0],32),n.set([e.light.direction[0],e.light.direction[1],e.light.direction[2],0],36),n.set([e.light.color[0],e.light.color[1],e.light.color[2],e.light.intensity],40);let r=e.environment,i=r.intensity??1,a=r.tint??[1,1,1],o=r.radiance[0]*a[0]*i,s=r.radiance[1]*a[1]*i,c=r.radiance[2]*a[2]*i;n.set([o,s,c,i],44);let l=r.sh;if(l)for(let e=0;e<9;e++)n.set([(l[e*3]??0)*a[0]*i,(l[e*3+1]??0)*a[1]*i,(l[e*3+2]??0)*a[2]*i,0],48+e*4);else{let e=3.544908;n.set([o*e,s*e,c*e,0],48)}let u=i*(r.textureRadianceScale??1);return n.set([a[0]*u,a[1]*u,a[2]*u,+!!r.hasTexture],84),n.set([r.envResX??0,r.envResY??0,r.envTotalSum??0,r.textureRadianceScale??1],88),n}function fe(e){let t=new Float32Array(12),n=e.surface;return t.set([n.baseColor[0],n.baseColor[1],n.baseColor[2],1],0),t.set([n.metalness,n.roughness,n.transmission,n.subsurface],4),t.set([n.ior,n.specular,0,0],8),t}function pe(e){switch(e){case`none`:return`c`;case`reinhard`:return`c / (vec3<f32>(1.0) + c)`;case`acesFilmic`:return`clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0))`}}function me(e){return`
fn srgb(c : vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}
fn display_color(hdr: vec3<f32>, exposure: f32) -> vec3<f32> {
  var c = max(hdr, vec3<f32>(0.0)) * exp2(exposure);
  c = ${pe(e)};
  return srgb(clamp(c, vec3<f32>(0.0), vec3<f32>(1e8)));
}`}function he(e){return`struct Resolve {
  exposure : f32,
};
@group(0) @binding(0) var hdrTex : texture_2d<f32>;
@group(0) @binding(1) var hdrSampler : sampler;
@group(0) @binding(2) var<uniform> r : Resolve;

struct VsOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VsOut {
  var out : VsOut;
  let uv = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u));
  out.uv = uv;
  out.clip = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

${me(e)}

@fragment
fn fs_main(in : VsOut) -> @location(0) vec4<f32> {
  let hdr = textureSample(hdrTex, hdrSampler, vec2<f32>(in.uv.x, 1.0 - in.uv.y)).rgb;
  return vec4<f32>(display_color(hdr, r.exposure), 1.0);
}`}var ge={coat:!0,transmission:!0,dispersion:!0,thinFilm:!0,lobeKinds:[0,1,2,3,4,5,6,7,8,9]},_e=`vs_forward`,ve=`fs_forward`;function ye(e,t){let n=t===`reference`,r=n?64:16;return`struct MxFrame {
  model: mat4x4f,
  viewProj: mat4x4f,
  eye: vec4f,
  lightDir: vec4f,
  lightColor: vec4f,
  env: vec4f,
  sh: array<vec4f, 9>,
  envMap: vec4f,
  envInfo: vec4f,
};
@group(3) @binding(0) var<uniform> fu: MxFrame;
@group(3) @binding(4) var forwardEnv: texture_2d<f32>;
@group(3) @binding(5) var forwardEnvSampler: sampler;
${n?`@group(3) @binding(6) var<storage, read> forwardEnvCdf: array<f32>;`:``}

fn mx_forward_uv(d: vec3f) -> vec2f {
  let n = normalize(d);
  return vec2f(atan2(n.z, n.x) * (0.5 / MX_PI) + 0.5, acos(clamp(n.y, -1.0, 1.0)) / MX_PI);
}

${n?`fn mx_forward_env_pdf(d: vec3f) -> f32 {
  if (fu.envMap.w == 0.0 || fu.envInfo.z <= 0.0) { return 0.0; }
  let uv = mx_forward_uv(d);
  let color = textureSampleLevel(forwardEnv, forwardEnvSampler, uv, 0.0).rgb * fu.envInfo.w;
  let lum = dot(color, vec3f(0.212671, 0.715160, 0.072169));
  return lum * fu.envInfo.x * fu.envInfo.y / (fu.envInfo.z * 2.0 * MX_PI * MX_PI * max(sin(uv.y * MX_PI), 1e-6));
}

fn mx_forward_env_direction(u: f32) -> vec3f {
  let width = u32(fu.envInfo.x);
  var low = 0u;
  var high = width * u32(fu.envInfo.y) - 1u;
  loop {
    if (low >= high) { break; }
    let mid = (low + high) / 2u;
    if (u * fu.envInfo.z < forwardEnvCdf[mid]) { high = mid; } else { low = mid + 1u; }
  }
  let uv = vec2f(f32(low % width), f32(low / width)) / fu.envInfo.xy;
  let phi = uv.x * (2.0 * MX_PI);
  let theta = uv.y * MX_PI;
  return vec3f(-sin(theta) * cos(phi), cos(theta), -sin(theta) * sin(phi));
}`:``}

fn mx_forward_environment(d: vec3f) -> vec3f {
  if (fu.envMap.w == 0.0) { return fu.env.xyz; }
  let uv = mx_forward_uv(d);
  return textureSampleLevel(forwardEnv, forwardEnvSampler, uv, 0.0).rgb * fu.envMap.xyz;
}
${n?``:`
fn mx_forward_filtered_environment(d: vec3f, pdf: f32) -> vec3f {
  if (fu.envMap.w == 0.0) { return fu.env.xyz; }
  let uv = mx_forward_uv(d);
  let dimensions = vec2f(textureDimensions(forwardEnv));
  let texelSolidAngle = 2.0 * MX_PI * MX_PI * max(sin(uv.y * MX_PI), 1e-6)
    / (dimensions.x * dimensions.y);
  let sampleSolidAngle = 1.0 / max(${r}.0 * pdf, 1e-20);
  let lod = clamp(0.5 * log2(sampleSolidAngle / texelSolidAngle),
    0.0, f32(textureNumLevels(forwardEnv) - 1u));
  return textureSampleLevel(forwardEnv, forwardEnvSampler, uv, lod).rgb * fu.envMap.xyz;
}
`}

fn mx_forward_sample_diffuse(c: LayeredClosure) -> bool {
  return c.hasCoat != 0u && c.coat.weight > 0.0
    && !(c.hasFuzz != 0u && c.fuzz.weight > 0.0);
}
${e.coat?`
fn mx_forward_coated_diffuse(c: LayeredClosure, wo: vec3f, frame: mat3x3f) -> vec3f {
  let albedo = mx_closure_diffuse_albedo(c, wo);
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  var radiance = vec3f(0.0);
  for (var i = 0u; i < ${r}u; i++) {
    let u = vec2f((f32(i) + 0.5) / ${r}.0,
      f32(reverseBits(i)) * 2.3283064365386963e-10);
    let wi = mx_cosine_hemisphere(u);
    let wiWorld = frame * wi;
    let pdf = wi.z / MX_PI;
${n?`    let envPdf = mx_forward_env_pdf(wiWorld);
    let mis = pdf * pdf / max(pdf * pdf + envPdf * envPdf, 1e-20);`:`    let mis = 1.0;`}
    let attenuation = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, wi);
    radiance = radiance + albedo * attenuation * ${n?`mx_forward_environment(wiWorld)`:`mx_forward_filtered_environment(wiWorld, pdf)`} * (mis / ${r}.0);
${n?`    if (fu.envMap.w != 0.0 && fu.envInfo.z > 0.0) {
      let lightWorld = mx_forward_env_direction(u.x);
      let light = transpose(frame) * lightWorld;
      let lightPdf = mx_forward_env_pdf(lightWorld);
      if (light.z > 0.0 && lightPdf > 0.0) {
        let bsdfPdf = light.z / MX_PI;
        let lightMis = lightPdf * lightPdf / max(lightPdf * lightPdf + bsdfPdf * bsdfPdf, 1e-20);
        let att = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, light);
        radiance = radiance + albedo * att * mx_forward_environment(lightWorld)
          * (lightMis * bsdfPdf / (64.0 * lightPdf));
      }
    }`:``}
  }
  return radiance;
}
`:``}
// SH integrates diffuse and LTC fuzz. Keep the fuzz attenuation but remove its
// response from the sampled closure so its environment energy is not counted twice.
fn mx_forward_specular_closure(c: LayeredClosure) -> LayeredClosure {
  var spec = c;
  spec.fuzz.color = vec3f(0.0);
  for (var i = 0u; i < spec.lobeCount; i++) {
    let kind = spec.lobes[i].kind;
    if (!(kind == MX_LOBE_DIELECTRIC_REFLECTION || kind == MX_LOBE_CONDUCTOR
        || kind == MX_LOBE_GENERALIZED_SCHLICK || kind == MX_LOBE_DIELECTRIC_TRANSMISSION
        || kind == MX_LOBE_CHIANG_HAIR)) {
      spec.lobes[i].weight = 0.0;
    }
  }
  return spec;
}
${e.transmission?`
fn mx_forward_is_smooth_sheet(c: LayeredClosure) -> bool {
  if (c.hasCoat != 0u && c.coat.weight > 0.0) { return false; }
  var hasTransmission = false;
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.roughness != 0.0 || l.anisotropy != 0.0) { return false; }
    if (l.kind != MX_LOBE_DIELECTRIC_REFLECTION
        && !(l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin > 0.0)) { return false; }
    if (l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION) { hasTransmission = true; }
  }
  return hasTransmission;
}

// A smooth sheet has two delta directions; integrate them without repeatedly
// evaluating the thin-film interference inside the GGX quadrature.
fn mx_forward_smooth_sheet(c: LayeredClosure, wo: vec3f, frame: mat3x3f) -> vec3f {
  let cosV = abs(wo.z);
  let reflected = mx_forward_environment(frame * vec3f(-wo.xy, wo.z));
  let transmitted = mx_forward_environment(frame * (-wo));
  var radiance = vec3f(0.0);
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION) {
      let f0 = vec3f(mx_dielectric_f0(l.ior));
      var f = mx_fresnel_schlick(f0, cosV);
      if (c.hasThinFilm != 0u) {
        f = mx_thin_film_fresnel(f, f0, cosV, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior);
      }
      radiance = radiance + l.weight * f * reflected;
    } else {
      let f = mx_fresnel_dielectric(cosV, l.ior);
      radiance = radiance + l.weight * l.color * (1.0 - f) * transmitted;
    }
  }
  return radiance;
}
`:``}
fn mx_forward_single_dielectric(c: LayeredClosure) -> i32 {
  if (c.hasCoat != 0u && c.coat.weight > 0.0) { return -1; }
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) { return -1; }
  if (c.hasThinFilm != 0u && c.thinFilm.weight > 0.0 && c.thinFilm.thickness > 0.0) { return -1; }
  var index = -1;
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (index >= 0 || (l.kind != MX_LOBE_DIELECTRIC_TRANSMISSION
        && l.kind != MX_LOBE_DIELECTRIC_REFLECTION
        && l.kind != MX_LOBE_CONDUCTOR && l.kind != MX_LOBE_GENERALIZED_SCHLICK)) { return -1; }
    index = i32(i);
  }
  return index;
}

// A single specular lobe can be sampled directly; transmission includes both
// reflection and refraction. Avoid re-evaluating the entire layered stack at
// every quadrature sample, which can exhaust the mobile fragment budget.
fn mx_forward_dielectric_environment(l: MxBsdfLobe, wo: vec3f, frame: mat3x3f) -> vec3f {
  return mx_forward_lobe_environment(l, wo, frame, 0.0, 1.0, vec3f(1.0));
}

fn mx_forward_lobe_environment(l: MxBsdfLobe, wo: vec3f, frame: mat3x3f,
    coatW: f32, coatIor: f32, coatColor: vec3f) -> vec3f {
  let ctx = mx_closure_lobe_ctx(l, wo);
  let deltaSpecular = (l.kind == MX_LOBE_DIELECTRIC_REFLECTION
    || l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION) && l.roughness < 0.07;
  var radiance = vec3f(0.0);
  for (var i = 0u; i < ${r}u; i++) {
    let u = vec3f((f32(i) + 0.5) / ${r}.0,
      f32(reverseBits(i)) * 2.3283064365386963e-10,
      fract((f32(i) + 0.5) * 0.61803398875));
    var bs: MxBsdfSample;
    if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION) {
      bs = mx_dielectric_reflection_sample(ctx, u.xy);
    } else if (l.kind == MX_LOBE_CONDUCTOR || l.kind == MX_LOBE_GENERALIZED_SCHLICK) {
      bs = mx_conductor_sample(ctx, u.xy);
    } else {
      bs = mx_dielectric_transmission_sample(ctx, u);
    }
    if (bs.valid && bs.pdf > 0.0) {
${n?`      let envDir = mx_forward_environment(frame * bs.wi);`:`      var envDir: vec3f;
      if (deltaSpecular) { envDir = mx_forward_environment(frame * bs.wi); }
      else { envDir = mx_forward_filtered_environment(frame * bs.wi, bs.pdf); }`}
      var mis = 1.0;
${n?`      if (!deltaSpecular) {
        let envPdf = mx_forward_env_pdf(frame * bs.wi);
        mis = bs.pdf * bs.pdf / max(bs.pdf * bs.pdf + envPdf * envPdf, 1e-20);
      }`:``}
      let att = mx_coat_attenuation(coatW, coatIor, coatColor, wo, bs.wi);
      radiance = radiance + att * l.weight * bs.value * envDir * (mis * abs(bs.wi.z) / (${r}.0 * bs.pdf));
    }
${n?`    if (!deltaSpecular && fu.envMap.w != 0.0 && fu.envInfo.z > 0.0) {
      let wiWorld = mx_forward_env_direction((f32(i) + 0.5) / 64.0);
      let wi = transpose(frame) * wiWorld;
      let envPdf = mx_forward_env_pdf(wiWorld);
      if (envPdf > 0.0) {
        var em: MxBsdfEval;
        if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION) {
          em = mx_dielectric_reflection_eval(ctx, wi);
        } else if (l.kind == MX_LOBE_CONDUCTOR || l.kind == MX_LOBE_GENERALIZED_SCHLICK) {
          em = mx_conductor_eval(ctx, wi);
        } else {
          em = mx_dielectric_transmission_eval(ctx, wi);
        }
        let mis = envPdf * envPdf / max(envPdf * envPdf + em.pdf * em.pdf, 1e-20);
        let att = mx_coat_attenuation(coatW, coatIor, coatColor, wo, wi);
        radiance = radiance + att * l.weight * em.value * mx_forward_environment(wiWorld) * (mis * abs(wi.z) / (64.0 * envPdf));
      }
    }`:``}
  }
  return radiance;
}
${e.coat?`
fn mx_forward_simple_coat(c: LayeredClosure) -> bool {
  if (!mx_forward_sample_diffuse(c) || c.hasThinFilm != 0u) { return false; }
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind != MX_LOBE_DIELECTRIC_REFLECTION && l.kind != MX_LOBE_CONDUCTOR
        && l.kind != MX_LOBE_GENERALIZED_SCHLICK) { return false; }
  }
  return true;
}

fn mx_forward_coated_specular(c: LayeredClosure, wo: vec3f, frame: mat3x3f) -> vec3f {
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  var coat: MxBsdfLobe;
  coat.kind = MX_LOBE_DIELECTRIC_REFLECTION;
  coat.weight = coatW;
  coat.ior = c.coat.ior;
  coat.roughness = c.coat.roughness;
  var radiance = mx_forward_dielectric_environment(coat, wo, frame);
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    radiance = radiance + mx_forward_lobe_environment(l, wo, frame, coatW, c.coat.ior, c.coat.color);
  }
  return radiance;
}
`:``}
// Diffuse irradiance E(n) from the uploaded SH9 radiance coefficients (cosine-lobe
// convolution A_l). Basis matches projectIrradianceSH on the CPU and mx_sh_irradiance
// in the path tracer so raster and path-traced diffuse IBL agree.
fn mx_sh_irradiance(n: vec3f) -> vec3f {
  let x = n.x; let y = n.y; let z = n.z;
  let A0 = 3.141593; let A1 = 2.094395; let A2 = 0.785398;
  var e = fu.sh[0].xyz * (A0 * 0.282095);
  e = e + fu.sh[1].xyz * (A1 * 0.488603 * y);
  e = e + fu.sh[2].xyz * (A1 * 0.488603 * z);
  e = e + fu.sh[3].xyz * (A1 * 0.488603 * x);
  e = e + fu.sh[4].xyz * (A2 * 1.092548 * x * y);
  e = e + fu.sh[5].xyz * (A2 * 1.092548 * y * z);
  e = e + fu.sh[6].xyz * (A2 * 0.315392 * (3.0 * z * z - 1.0));
  e = e + fu.sh[7].xyz * (A2 * 1.092548 * x * z);
  e = e + fu.sh[8].xyz * (A2 * 0.546274 * (x * x - y * y));
  return e;
}`}function be(){return`fn basis(n: vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3f(b, s + n.y * n.y * a, -n.y);
  return mat3x3f(t, bt, n);
}`}function xe(e){return`${e?`struct MxDisp { scale: f32, midpoint: f32, pad0: f32, pad1: f32 };
@group(3) @binding(1) var dispTex: texture_2d<f32>;
@group(3) @binding(2) var dispSamp: sampler;
@group(3) @binding(3) var<uniform> du: MxDisp;
`:``}struct MxVertexIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) texcoord: vec2f,
  @location(3) tangent: vec4f,
};
struct MxVertexOut {
  @builtin(position) clip: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) texcoord: vec2f,
  @location(3) viewDir: vec3f,
  @location(4) worldTangent: vec4f,
};
@vertex
fn ${_e}(vin: MxVertexIn) -> MxVertexOut {
${e?`  let h = textureSampleLevel(dispTex, dispSamp, vin.texcoord, 0.0).r;
  let localPos = vin.position + vin.normal * ((h - du.midpoint) * du.scale);`:`  let localPos = vin.position;`}
  let world = fu.model * vec4f(localPos, 1.0);
  let worldPos = world.xyz;
  let worldNormal = normalize((fu.model * vec4f(vin.normal, 0.0)).xyz);
  var out: MxVertexOut;
  out.clip = fu.viewProj * world;
  out.worldPos = worldPos;
  out.worldNormal = worldNormal;
  out.texcoord = vin.texcoord;
  out.viewDir = normalize(fu.eye.xyz - worldPos);
  let tangent = (fu.model * vec4f(vin.tangent.xyz, 0.0)).xyz;
  let modelSign = select(1.0, -1.0, determinant(mat3x3f(fu.model[0].xyz, fu.model[1].xyz, fu.model[2].xyz)) < 0.0);
  out.worldTangent = vec4f(tangent / max(length(tangent), 1e-20), vin.tangent.w * modelSign);
  return out;
}`}function Se(e,t,n,r){let i=r===`reference`,a=i?64:16,o=t.filter(e=>e===`st`).map(e=>`  vary.v_${e} = fin.texcoord;`).join(`
`);return`@fragment
fn ${ve}(fin: MxVertexOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  var vary: MxVaryings;
  vary.position = fin.worldPos;
  vary.normal = normalize(fin.worldNormal);
  let fallbackFrame = basis(vary.normal);
  let projectedTangent = fin.worldTangent.xyz - vary.normal * dot(vary.normal, fin.worldTangent.xyz);
  var tangent = fallbackFrame[0];
  var bitangent = fallbackFrame[1];
  if (dot(projectedTangent, projectedTangent) > 1e-10) {
    tangent = normalize(projectedTangent);
    bitangent = normalize(cross(vary.normal, tangent)) * select(1.0, -1.0, fin.worldTangent.w < 0.0);
  }
  vary.tangent = tangent;
  vary.bitangent = bitangent;
  vary.viewDir = normalize(fin.viewDir);
  vary.texcoord = fin.texcoord;${o?`
`+o:``}
  let c = ${e}(vary);
  if (c.opacity <= 0.0) { discard; }
  var authoredNormal = mx_closure_shading_normal(c, vary.normal);
  let facing = dot(authoredNormal, vary.viewDir);
  // Smoothed front-face normals can cross the silhouette's viewing hemisphere.
  // Reflect across its tangent plane continuously instead of flipping by 180 degrees.
  if (frontFacing && facing < 0.0) {
    authoredNormal = normalize(authoredNormal - 2.0 * facing * vary.viewDir);
  }
  let n = mx_closure_oriented_normal(c, authoredNormal, vary.viewDir);
  let sframe = mx_closure_frame(c, n, basis(n));
  let wo = transpose(sframe) * vary.viewDir;

  var radiance = vec3f(0.0);
${n.dispersion?`  if (mx_closure_has_dispersion(c)) {
    for (var channel = 0u; channel < 3u; channel++) {
      let spectral = mx_closure_spectral_channel(c, channel);
      let light = mx_forward_lighting(spectral, n, wo, sframe);
      radiance[channel] = light[channel];
    }
  } else {
    radiance = mx_forward_lighting(c, n, wo, sframe);
  }`:`  radiance = mx_forward_lighting(c, n, wo, sframe);`}
  return vec4f(radiance, clamp(c.opacity, 0.0, 1.0));
}

fn mx_forward_lighting(c: LayeredClosure, n: vec3f, wo: vec3f, sframe: mat3x3f) -> vec3f {
  // Direct next-event term for the distant (delta) light: a delta direction has
  // no BSDF-sampling counterpart, mirroring the delta light in compute.ts. Raster
  // omits the shadow ray (no occlusion test in the forward pass).
  let toLight = normalize(-fu.lightDir.xyz);
  let wiLight = transpose(sframe) * toLight;
  let ev = mx_closure_eval(c, wo, wiLight);
  let cosL = ${n.lobeKinds.includes(9)?`abs(dot(n, toLight))`:`max(dot(n, toLight), 0.0)`};
  var radiance = ev.value * (fu.lightColor.xyz * fu.lightColor.w) * cosL;

  // Diffuse environment IBL read analytically from the SH9 irradiance probe (the
  // same noise-free term the path tracer uses), so textured albedo reads at the
  // correct brightness instead of the dim constant-ambient estimate.
${n.coat?`  if (!mx_forward_sample_diffuse(c)) {
    radiance = radiance + mx_closure_diffuse_albedo(c, wo) * (mx_sh_irradiance(n) / MX_PI);
  } else {
    radiance = radiance + mx_forward_coated_diffuse(c, wo, sframe);
  }`:`  radiance = radiance + mx_closure_diffuse_albedo(c, wo) * (mx_sh_irradiance(n) / MX_PI);`}

  // Deterministic BSDF quadrature of the actual dome; diffuse stays in SH above.
  let spec = mx_forward_specular_closure(c);
  let deltaSpecular = mx_closure_is_specular(spec);
  let dielectricIndex = mx_forward_single_dielectric(spec);
  ${n.coat?`if (mx_forward_simple_coat(spec)) {
    radiance = radiance + mx_forward_coated_specular(spec, wo, sframe);
  } else `:``}${n.transmission?`if (mx_forward_is_smooth_sheet(spec)) {
    radiance = radiance + mx_forward_smooth_sheet(spec, wo, sframe);
  } else `:``}if (dielectricIndex >= 0) {
    radiance = radiance + mx_forward_dielectric_environment(spec.lobes[u32(dielectricIndex)], wo, sframe);
  } else {
    for (var i = 0u; i < ${a}u; i++) {
      let u = vec3f((f32(i) + 0.5) / ${a}.0,
        f32(reverseBits(i)) * 2.3283064365386963e-10,
        fract((f32(i) + 0.5) * 0.61803398875));
      let bs = mx_closure_sample(spec, wo, u);
      if (bs.valid && bs.pdf > 0.0) {
${i?`        let envDir = mx_forward_environment(sframe * bs.wi);`:`        var envDir: vec3f;
        if (deltaSpecular) { envDir = mx_forward_environment(sframe * bs.wi); }
        else { envDir = mx_forward_filtered_environment(sframe * bs.wi, bs.pdf); }`}
        var mis = 1.0;
${i?`        if (!deltaSpecular) {
          let envPdf = mx_forward_env_pdf(sframe * bs.wi);
          mis = bs.pdf * bs.pdf / max(bs.pdf * bs.pdf + envPdf * envPdf, 1e-20);
        }`:``}
        radiance = radiance + bs.value * envDir * (mis * abs(bs.wi.z) / (${a}.0 * bs.pdf));
      }
${i?`      if (!deltaSpecular && fu.envMap.w != 0.0 && fu.envInfo.z > 0.0) {
        let wiWorld = mx_forward_env_direction((f32(i) + 0.5) / 64.0);
        let wi = transpose(sframe) * wiWorld;
        let envPdf = mx_forward_env_pdf(wiWorld);
        if (envPdf > 0.0) {
          let em = mx_closure_eval(spec, wo, wi);
          let mis = envPdf * envPdf / max(envPdf * envPdf + em.pdf * em.pdf, 1e-20);
          radiance = radiance + em.value * mx_forward_environment(wiWorld) * (mis * abs(wi.z) / (64.0 * envPdf));
        }
      }`:``}
    }
  }

  if (c.hasEmission != 0u) { radiance = radiance + c.emission; }
  return radiance;
}`}function Ce(e,t={}){let n=t.displacement===!0,r=t.rasterQuality??`reference`,i=e.features??ge;return{code:[e.code.trimEnd(),ye(i,r),be(),xe(n),Se(e.entryPoint,[...e.primvarFields.keys()],i,r)].join(`

`)+`
`,vertexEntry:_e,fragmentEntry:ve,frameGroup:3,frameBinding:0,rasterQuality:r,...n?{displacementGroup:3}:{}}}var we=3,Te=[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:`float32x3`}]},{arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:`float32x3`}]},{arrayStride:8,attributes:[{shaderLocation:2,offset:0,format:`float32x2`}]},{arrayStride:16,attributes:[{shaderLocation:3,offset:0,format:`float32x4`}]}],Ee=class{hdrFormat;outputFormat;depthFormat;tonemap;device;forward;resolve;sceneVariants=new Map;constructor(e){this.device=e.device,this.outputFormat=e.outputFormat,this.hdrFormat=e.hdrFormat??`rgba16float`,this.depthFormat=e.depthFormat??`depth24plus`,this.tonemap=e.tonemap??`acesFilmic`}get forwardPipeline(){return this.forward}get resolvePipeline(){return this.resolve}sceneVariantPipeline(e,t){return this.sceneVariants.get(`${e}:${t}`)}createForwardPipeline(e){let t=this.device.createShaderModule({code:e});return this.forward=this.device.createRenderPipeline({layout:`auto`,vertex:{module:t,entryPoint:_e,buffers:Te},fragment:{module:t,entryPoint:ve,targets:[{format:this.hdrFormat}]},primitive:{topology:`triangle-list`,cullMode:`back`},depthStencil:{format:this.depthFormat,depthWriteEnabled:!0,depthCompare:`less`}}),this.forward}createResolvePipeline(){let e=this.device.createShaderModule({code:he(this.tonemap)});return this.resolve=this.device.createRenderPipeline({layout:`auto`,vertex:{module:e,entryPoint:`vs_main`},fragment:{module:e,entryPoint:`fs_main`,targets:[{format:this.outputFormat}]},primitive:{topology:`triangle-list`}}),this.resolve}createSceneVariantPipeline(e,t,n,r){let i=`${e}:${t}`,a=this.sceneVariants.get(i);if(a)return a;let o=r??this.device.createShaderModule({code:n}),s=e===`transmission`,c=this.device.createRenderPipeline({layout:`auto`,vertex:{module:o,entryPoint:_e,buffers:Te},fragment:{module:o,entryPoint:ve,targets:[this.sceneColorTarget(s)]},primitive:{topology:`triangle-list`,cullMode:e===`opaque`?`back`:`none`},depthStencil:{format:this.depthFormat,depthWriteEnabled:!s,depthCompare:`less`}});return this.sceneVariants.set(i,c),c}sceneColorTarget(e){return e?{format:this.hdrFormat,blend:{color:{srcFactor:`src-alpha`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}}:{format:this.hdrFormat}}recordScenePass(e,t){let n=t.clear??!0,r=t.clearColor??[0,0,0],i=e.beginRenderPass({colorAttachments:[{view:t.hdrView,clearValue:{r:r[0],g:r[1],b:r[2],a:1},loadOp:n?`clear`:`load`,storeOp:`store`}],depthStencilAttachment:{view:t.depthView,depthClearValue:1,depthLoadOp:n?`clear`:`load`,depthStoreOp:`store`}});if(t.scissor){let e=t.scissor;i.setScissorRect(e.x,e.y,e.width,e.height)}let a;for(let e of t.draws){let n=this.sceneVariantPipeline(t.pass,e.pipelineKey);if(!n)throw Error(`scene ${t.pass} variant pipeline not created: ${e.pipelineKey}`);if(n!==a&&(i.setPipeline(n),a=n),i.setBindGroup(0,e.materialBindGroup),i.setBindGroup(we,e.frameBindGroup),e.textureBindGroups)for(let[t,n]of e.textureBindGroups)i.setBindGroup(t,n);i.setVertexBuffer(0,e.positionBuffer),i.setVertexBuffer(1,e.normalBuffer),e.texcoordBuffer&&i.setVertexBuffer(2,e.texcoordBuffer),i.setVertexBuffer(3,e.tangentBuffer),i.setIndexBuffer(e.indexBuffer,`uint32`),i.drawIndexed(e.indexCount)}i.end()}recordOpaquePass(e,t){if(!this.forward)throw Error(`forward pipeline not created`);let n=e.beginRenderPass({colorAttachments:[{view:t.hdrView,clearValue:{r:0,g:0,b:0,a:1},loadOp:`clear`,storeOp:`store`}],depthStencilAttachment:{view:t.depthView,depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`store`}});n.setPipeline(this.forward),n.setBindGroup(0,t.materialBindGroup),n.setBindGroup(we,t.frameBindGroup),n.setVertexBuffer(0,t.geometry.positionBuffer),n.setVertexBuffer(1,t.geometry.normalBuffer),n.setVertexBuffer(2,t.geometry.texcoordBuffer),n.setVertexBuffer(3,t.geometry.tangentBuffer),n.setIndexBuffer(t.geometry.indexBuffer,`uint32`),n.drawIndexed(t.geometry.indexCount),n.end()}recordResolvePass(e,t){if(!this.resolve)throw Error(`resolve pipeline not created`);let n=e.beginRenderPass({colorAttachments:[{view:t.outputView,clearValue:{r:0,g:0,b:0,a:1},loadOp:`clear`,storeOp:`store`}]});n.setPipeline(this.resolve),n.setBindGroup(0,t.bindGroup),n.draw(3),n.end()}recordFrame(e,t,n){this.recordOpaquePass(e,t),this.recordResolvePass(e,n)}},De=class extends Error{name=`CacheError`};function Oe(e){return e===null?`null`:Array.isArray(e)?`[${e.map(Oe).join(`,`)}]`:typeof e==`object`?`{${Object.entries(e).filter(([,e])=>e!==void 0).sort(([e],[t])=>e<t?-1:+(e>t)).map(([e,t])=>`${JSON.stringify(e)}:${Oe(t)}`).join(`,`)}}`:JSON.stringify(e)??`null`}function ke(e){let t=2166136261;for(let n=0;n<e.length;n++)t^=e.charCodeAt(n),t=Math.imul(t,16777619);return(t>>>0).toString(16).padStart(8,`0`)}function Ae(e){return Oe(e)}function je(e){return new Promise((t,n)=>{e.onsuccess=()=>t(e.result),e.onerror=()=>n(e.error??new De(`IndexedDB request failed`))})}var Me=class{db;storeName;constructor(e,t){this.db=e,this.storeName=t}store(e){return this.db.transaction(this.storeName,e).objectStore(this.storeName)}async get(e){return je(this.store(`readonly`).get(e))}async set(e,t){await je(this.store(`readwrite`).put(t,e))}async delete(e){await je(this.store(`readwrite`).delete(e))}async keys(){return(await je(this.store(`readonly`).getAllKeys())).map(e=>String(e))}async clear(){await je(this.store(`readwrite`).clear())}};async function Ne(e,t){let n=globalThis.indexedDB;if(!n)throw new De(`IndexedDB is not available in this environment`);let r=n.open(e,1);return new Me(await new Promise((e,n)=>{r.onupgradeneeded=()=>{r.result.objectStoreNames.contains(t)||r.result.createObjectStore(t)},r.onsuccess=()=>e(r.result),r.onerror=()=>n(r.error??new De(`IndexedDB open failed`))}),t)}var N={kind:`scalar`,scalar:`float`},Pe={kind:`scalar`,scalar:`int`},Fe={kind:`scalar`,scalar:`bool`};function P(e,t=`float`,n){return n===void 0?{kind:`vector`,scalar:t,size:e}:{kind:`vector`,scalar:t,size:e,semantic:n}}var Ie=P(3,`float`,`color`),Le=P(4,`float`,`color`);function Re(e){return{kind:`matrix`,size:e}}function ze(e){return{kind:`closure`,closure:e}}function Be(e){return{kind:`shader`,shader:e}}function Ve(e){switch(e.kind){case`scalar`:return e.scalar;case`vector`:return`vec${e.size}<${e.scalar}${e.semantic?`:${e.semantic}`:``}>`;case`matrix`:return`mat${e.size}`;case`string`:return`string`;case`filename`:return`filename`;case`closure`:return`closure<${e.closure}>`;case`shader`:return`shader<${e.shader}>`}}var He={float:N,integer:Pe,boolean:Fe,color3:Ie,color4:Le,vector2:P(2,`float`,`vector`),vector3:P(3,`float`,`vector`),vector4:P(4,`float`,`vector`),matrix33:Re(3),matrix44:Re(4),string:{kind:`string`},filename:{kind:`filename`},BSDF:ze(`bsdf`),EDF:ze(`edf`),VDF:ze(`vdf`),surfaceshader:Be(`surface`),displacementshader:Be(`displacement`),volumeshader:Be(`volume`),lightshader:Be(`light`)};function Ue(e){return He[e]}function We(e,t){let n=Array.isArray(t)?`[${t.join(`,`)}]`:String(t);return`${Ve(e)}=${n}`}var Ge=class{counter=0;exprs=new Map;constRefs=new Map;textures=new Map;samplers=new Map;params=new Map;primvars=new Map;outputs=[];requirements={needsDerivatives:!1,needsTextureFootprint:!1,needsPdf:!1,needsSampling:!1};add(e){let t=`e${this.counter++}`;return this.exprs.set(t,e),t}constant(e,t,n){let r=We(e,t),i=this.constRefs.get(r);if(i)return i;let a=this.add(n?{kind:`const`,type:e,value:t,meta:n}:{kind:`const`,type:e,value:t});return this.constRefs.set(r,a),a}declareTexture(e){this.textures.set(e.name,e)}declareSampler(e){this.samplers.set(e.name,e)}declareParam(e){this.params.set(e.name,e)}declarePrimvar(e){this.primvars.set(e.name,e)}require(e){e.needsDerivatives&&(this.requirements.needsDerivatives=!0),e.needsTextureFootprint&&(this.requirements.needsTextureFootprint=!0),e.needsPdf&&(this.requirements.needsPdf=!0),e.needsSampling&&(this.requirements.needsSampling=!0)}output(e){this.outputs.push(e)}get(e){return this.exprs.get(e)}build(){return{exprs:new Map(this.exprs),outputs:[...this.outputs],textures:[...this.textures.values()],samplers:[...this.samplers.values()],params:[...this.params.values()],primvars:[...this.primvars.values()],requirements:{...this.requirements}}}},Ke=e=>e<0?0:e>1?1:e;function qe(e){let t=Ke(e.metalness),n=Ke(e.transmission),r=Ke(e.subsurface),i=Ke(e.specular),a=(1-t)*(1-n),o=r>0&&e.subsurfaceRadius!==void 0,s={kind:`dielectric_transmission`,weight:(1-t)*n,color:e.baseColor,roughness:e.roughness,ior:e.ior};e.attenuationColor!==void 0&&e.attenuationDistance!==void 0&&(s.attenuationColor=e.attenuationColor,s.attenuationDistance=e.attenuationDistance);let c=[{kind:`conductor`,weight:t,color:e.baseColor,roughness:e.roughness},s,{kind:`dielectric_reflection`,weight:a*i,color:[1,1,1],roughness:e.roughness,ior:e.ior},{kind:`burley_diffuse`,weight:o?a*(1-r):a,color:e.baseColor,roughness:e.roughness}];return o&&c.push({kind:`subsurface`,weight:a*r,color:e.subsurfaceColor??e.baseColor,subsurfaceRadius:e.subsurfaceRadius}),{lobes:c.filter(e=>e.weight>0),opacity:1}}var Je={position:0,normal:1,tangent:2,bitangent:3,texcoord:4,color:5,custom:6};function Ye(e,t){let n=e.toLowerCase();return n===`p`||n===`position`?`position`:n===`n`||n===`normal`?`normal`:n===`t`||n===`tangent`?`tangent`:n===`bitangent`||n===`binormal`?`bitangent`:t.kind===`vector`&&t.semantic===`texcoord`||n===`st`||n.startsWith(`uv`)||n.startsWith(`texcoord`)?`texcoord`:n.includes(`color`)||t.kind===`vector`&&t.semantic===`color`?`color`:`custom`}function Xe(e){let t=e.primvars.map(e=>({name:e.name,semantic:Ye(e.name,e.type),type:e.type}));return t.sort((e,t)=>Je[e.semantic]-Je[t.semantic]||(e.name<t.name?-1:+(e.name>t.name))),t.map((e,t)=>({...e,location:t}))}function Ze(e){return{uniforms:e.params.map(e=>({name:e.name,type:e.type})),textures:e.textures.map((e,t)=>({name:e.name,valueType:e.valueType,...e.colorSpace===void 0?{}:{colorSpace:e.colorSpace},group:1,binding:t})),samplers:e.samplers.map((e,t)=>({name:e.name,group:2,binding:t}))}}function Qe(e){let t=new Map;for(let n of e.exprs.values())if(n.kind===`closure`){let e=`${n.closure}|${n.op}`,r=t.get(e);r?r.count+=1:t.set(e,{kind:n.closure,op:n.op,count:1})}return[...t.values()].sort((e,t)=>e.op<t.op?-1:+(e.op>t.op))}function $e(e){let t=new Set;for(let n of e.exprs.values())switch(n.kind){case`closure`:t.add(n.op.toLowerCase());for(let e of Object.keys(n.params))t.add(e.toLowerCase());break;case`call`:t.add(n.op.toLowerCase());break;case`param`:case`input`:case`primvar`:t.add(n.name.toLowerCase())}for(let n of e.params)t.add(n.name.toLowerCase());return t}function et(e,t){for(let n of e)for(let e of t)if(n.includes(e))return!0;return!1}function tt(e){let t=new Set;for(let n of e.exprs.values())n.kind===`closure`&&t.add(n.closure);let n=$e(e),r=e.outputs.some(e=>e.type.kind===`shader`&&e.type.shader===`volume`),i=e.outputs.some(e=>e.type.kind===`shader`&&e.type.shader===`displacement`),a=et(n,[`transmission`,`dielectric_bsdf`,`translucent`]),o=t.has(`bssrdf`)||et(n,[`subsurface`]),s=t.has(`vdf`)||r||et(n,[`_vdf`,`absorption`,`anisotropic_vdf`]),c=et(n,[`coat`]),l=et(n,[`anisotrop`]),u=et(n,[`thin_film`,`thinfilm`]);return{hasBsdf:t.has(`bsdf`),hasEdf:t.has(`edf`),hasVdf:t.has(`vdf`),hasBssrdf:t.has(`bssrdf`),transparency:a||et(n,[`opacity`]),transmission:a,coat:c,anisotropy:l,thinFilm:u,subsurface:o,volume:s,displacement:i,needsTangentFrame:l||u}}function nt(e){let t=[];return e.displacement&&t.push({kind:`displacement`,reason:`displacementshader output present`}),t.push({kind:`opaque`,reason:`base surface shading`}),e.transmission&&t.push({kind:`transmission`,reason:`transmissive BSDF present`}),e.volume&&t.push({kind:`volume`,reason:`volume distribution present`}),t}function rt(e){return`flags[${Object.entries(e.flags).filter(([,e])=>e).map(([e])=>e).sort().join(`,`)}];attrs[${e.attributes.map(e=>`${e.semantic}:${Ve(e.type)}`).join(`|`)}];closures[${e.closures.map(e=>`${e.kind}.${e.op}`).join(`|`)}];req[${Object.entries(e.requirements).filter(([,e])=>e).map(([e])=>e).sort().join(`,`)}];passes[${e.passes.map(e=>e.kind).join(`,`)}]`}function it(e){let t=Xe(e),n=Ze(e),r=Qe(e),i=tt(e),a={attributes:t,layout:n,closures:r,flags:i,passes:nt(i),requirements:{...e.requirements}};return{...a,variantKey:rt(a)}}function at(){return{min:[1/0,1/0,1/0],max:[-1/0,-1/0,-1/0]}}function ot(e,t){for(let n=0;n<3;n++)t[n]<e.min[n]&&(e.min[n]=t[n]),t[n]>e.max[n]&&(e.max[n]=t[n])}function st(e,t){for(let n=0;n<3;n++)t.min[n]<e.min[n]&&(e.min[n]=t.min[n]),t.max[n]>e.max[n]&&(e.max[n]=t.max[n])}function ct(e){let t=e.max[0]-e.min[0],n=e.max[1]-e.min[1],r=e.max[2]-e.min[2];return 2*(t*n+t*r+n*r)}function lt(e,t){let n=1/0,r=-1,i=-1;for(let a=0;a<3;a++){let o=t.max[a]-t.min[a];if(o<=0)continue;let s=Array.from({length:16},()=>({...at(),count:0}));for(let n of e){let e=s[Math.min(15,Math.floor((n.centroid[a]-t.min[a])/o*16))];ot(e,n.min),ot(e,n.max),e.count++}let c=new Float64Array(16),l=new Uint32Array(16),u=at(),d=0;for(let e=15;e>=0;e--){let t=s[e];t.count&&st(u,t),d+=t.count,l[e]=d,c[e]=d?ct(u)*d:0}let f=at();d=0;for(let e=0;e<15;e++){let t=s[e];if(t.count&&st(f,t),d+=t.count,!d||!l[e+1])continue;let o=ct(f)*d+c[e+1];o<n&&(n=o,r=a,i=e)}}if(r<0)return;let a=t.max[r]-t.min[r],o=[],s=[];for(let n of e)(Math.min(15,Math.floor((n.centroid[r]-t.min[r])/a*16))<=i?o:s).push(n);return o.length&&s.length?[o,s]:void 0}function ut(e,t,n=`median`){let r=[],i=[],a=(e,o=0)=>{let s=at(),c=at();for(let t of e)ot(s,t.min),ot(s,t.max),ot(c,t.centroid);let l=r.length,u={min:s.min,max:s.max,left:-1,right:-1,start:0,count:0};if(r.push(u),e.length<=t){u.start=i.length,u.count=e.length;for(let t of e)i.push(t.index);return l}let d=0,f=-1/0;for(let e=0;e<3;e++){let t=c.max[e]-c.min[e];t>f&&(f=t,d=e)}let p=n===`sah`&&o<40?lt(e,c):void 0;p||e.sort((e,t)=>e.centroid[d]-t.centroid[d]);let m=e.length>>1,[h,g]=p??[e.slice(0,m),e.slice(m)];return u.left=a(h,o+1),u.right=a(g,o+1),l};return e.length>0&&a(e),{nodes:r,order:Uint32Array.from(i)}}function dt(e,t,n){let r=at();for(let i=0;i<3;i++){let a=t[n*3+i];ot(r,[e[a*3],e[a*3+1],e[a*3+2]])}return{min:r.min,max:r.max,centroid:[(r.min[0]+r.max[0])*.5,(r.min[1]+r.max[1])*.5,(r.min[2]+r.max[2])*.5]}}function ft(e,t,n={}){let r=Math.max(1,n.maxLeafTriangles??4),i=Math.floor(t.length/3),a=[];for(let n=0;n<i;n++){let r=dt(e,t,n);a.push({index:n,min:r.min,max:r.max,centroid:r.centroid})}let{nodes:o,order:s}=ut(a,r,n.splitStrategy);return{nodes:o,triangleOrder:s,bounds:o.length>0?{min:o[0].min,max:o[0].max}:{min:[0,0,0],max:[0,0,0]}}}function pt(e,t={}){let n=Math.max(1,t.maxLeafTriangles??2),{nodes:r,order:i}=ut(e.map((e,t)=>({index:t,min:[e.min[0],e.min[1],e.min[2]],max:[e.max[0],e.max[1],e.max[2]],centroid:[(e.min[0]+e.max[0])*.5,(e.min[1]+e.max[1])*.5,(e.min[2]+e.max[2])*.5]})),n,t.splitStrategy);return{nodes:r,instanceOrder:i,bounds:r.length>0?{min:r[0].min,max:r[0].max}:{min:[0,0,0],max:[0,0,0]}}}var mt=1,ht=`materialx-webgpu-engine`,gt=`prepared-geometry`,_t=`geometry:v1:`,vt=`pathtrace-bvh:v2-sah:`,yt=class{store;constructor(e){this.store=e}async get(e){return await this.store.get(`${_t}${e}`)}async set(e,t){await this.store.set(`${_t}${e}`,t)}},bt=class{store;constructor(e){this.store=e}async get(e){return await this.store.get(`${vt}${e}`)}async set(e,t){await this.store.set(`${vt}${e}`,t)}},xt,St;function Ct(){return xt??=Ne(ht,gt).then(e=>new yt(e)).catch(e=>{throw xt=void 0,e}),xt}function wt(){return St??=Ne(ht,gt).then(e=>new bt(e)).catch(e=>{throw St=void 0,e}),St}function Tt(e){return typeof e==`number`?Number.isNaN(e)?`"__NaN__"`:e===1/0?`"__Infinity__"`:e===-1/0?`"__-Infinity__"`:Object.is(e,-0)?`"__-0__"`:JSON.stringify(e):typeof e!=`object`||!e?JSON.stringify(e)??`null`:Array.isArray(e)?`[${e.map(Tt).join(`,`)}]`:`{${Object.entries(e).filter(([,e])=>e!==void 0).sort(([e],[t])=>e.localeCompare(t)).map(([e,t])=>`${JSON.stringify(e)}:${Tt(t)}`).join(`,`)}}`}async function Et(e,t){let n=globalThis.crypto?.subtle;if(!n)return;let r=`{"cacheVersion":${mt},"mesh":${Tt(e)},"options":${Tt(t)}}`,i=await n.digest(`SHA-256`,new TextEncoder().encode(r));return Array.from(new Uint8Array(i),e=>e.toString(16).padStart(2,`0`)).join(``)}async function Dt(e){let t=globalThis.crypto?.subtle;if(!t)return;let n=await t.digest(`SHA-256`,e);return Array.from(new Uint8Array(n),e=>e.toString(16).padStart(2,`0`)).join(``)}var Ot=new Set([`catmullClark`,`loop`,`bilinear`]),kt=new Set([`st`,`uv`,`texcoord`,`map1`]),At=1e5;function jt(e,t={}){let n=t.sink??(()=>void 0),r=e.subdivisionScheme??`none`,i=e.refinementLevel??0,a=e,o=!1;Ot.has(r)&&i>0&&(t.subdivider?(a=t.subdivider.refine(e,r,i),o=!0):n({level:`warning`,message:`Subdivision '${r}' level ${i} pending: no subdivider provided; rendering base cage.`}));let s=new Set(a.holeIndices??[]),c=a.leftHanded??!1,l=(a.primvars??[]).find(e=>kt.has(e.name)),u=(a.primvars??[]).filter(e=>e!==l),d=a.normals?void 0:Nt(a,s,c),f=Mt(a,s,c),p=[],m=[],h=[],g=u.map(()=>[]),_=[],v=[],y=new Map,b=e=>{let t=zt(a.points,e.pointIndex,3),n=a.normals?It(a.normals,e,3):d.get(e.pointIndex)??[0,0,1],r=l?It(l,e,l.elementSize):void 0,i=u.map(t=>It(t,e,t.elementSize)),o=Lt(e.pointIndex,n,r,i),s=y.get(o);if(s!==void 0)return s;let c=p.length/3;return p.push(t[0],t[1],t[2]),m.push(n[0],n[1],n[2]),r&&h.push(...r),i.forEach((e,t)=>g[t].push(...e)),y.set(o,c),c};for(let e of f)_.push(b(e.a),b(e.b),b(e.c)),v.push(e.faceIndex);let x=p.length/3,S={positions:Float32Array.from(p),normals:Float32Array.from(m),...l?{uvs:Float32Array.from(h)}:{}};(l&&t.computeTangents!==!1||t.computeTangents)&&(S.uvs?S.tangents=Pt(S.positions,S.normals,S.uvs,_,x):t.computeTangents&&n({level:`info`,message:`Tangent generation requested but no UV primvar is present.`}));let C=new Map;u.forEach((e,t)=>{C.set(e.name,{elementSize:e.elementSize,values:Float32Array.from(g[t])})});let w=Ft(a.subsets??[],v,n);return{positions:S.positions,normals:S.normals,...S.uvs?{uvs:S.uvs}:{},...S.tangents?{tangents:S.tangents}:{},indices:Uint32Array.from(_),attributes:C,subsets:w,subdivision:{scheme:r,level:i,applied:o},displacement:{required:t.hasDisplacement??!1}}}function Mt(e,t,n){let r=[],i=0;for(let a=0;a<e.faceVertexCounts.length;a++){let o=e.faceVertexCounts[a];if(t.has(a)||o<3){i+=o;continue}let s=[];for(let t=0;t<o;t++){let n=i+t;s.push({pointIndex:e.faceVertexIndices[n],faceIndex:a,cornerIndex:n})}for(let e=1;e<o-1;e++){let t=s[0],i=s[e],o=s[e+1];r.push(n?{a:t,b:o,c:i,faceIndex:a}:{a:t,b:i,c:o,faceIndex:a})}i+=o}return r}function Nt(e,t,n){let r=new Map,i=0;for(let a=0;a<e.faceVertexCounts.length;a++){let o=e.faceVertexCounts[a];if(t.has(a)||o<3){i+=o;continue}let s=e.faceVertexIndices[i];for(let t=1;t<o-1;t++){let a=s,o=e.faceVertexIndices[i+t],c=e.faceVertexIndices[i+t+1],l=zt(e.points,a,3),u=zt(e.points,o,3),d=zt(e.points,c,3),f=Ut(Ht(u,l),Ht(d,l));n&&(f=[-f[0],-f[1],-f[2]]);for(let e of[a,o,c]){let t=r.get(e)??[0,0,0];r.set(e,[t[0]+f[0],t[1]+f[1],t[2]+f[2]])}}i+=o}for(let[e,t]of r)r.set(e,Gt(t));return r}function Pt(e,t,n,r,i){let a=new Float32Array(i*3),o=new Float32Array(i*3);for(let t=0;t<r.length;t+=3){let i=r[t],s=r[t+1],c=r[t+2],l=Bt(e,i),u=Bt(e,s),d=Bt(e,c),f=Vt(n,i),p=Vt(n,s),m=Vt(n,c),h=Ht(u,l),g=Ht(d,l),_=p[0]-f[0],v=p[1]-f[1],y=m[0]-f[0],b=m[1]-f[1],x=_*b-y*v,S=x===0?0:1/x,C=[(b*h[0]-v*g[0])*S,(b*h[1]-v*g[1])*S,(b*h[2]-v*g[2])*S],w=[(_*g[0]-y*h[0])*S,(_*g[1]-y*h[1])*S,(_*g[2]-y*h[2])*S];for(let e of[i,s,c])a[e*3]+=C[0],a[e*3+1]+=C[1],a[e*3+2]+=C[2],o[e*3]+=w[0],o[e*3+1]+=w[1],o[e*3+2]+=w[2]}let s=new Float32Array(i*4);for(let e=0;e<i;e++){let n=Bt(t,e),r=Bt(a,e),i=Wt(n,r),c=[r[0]-n[0]*i,r[1]-n[1]*i,r[2]-n[2]*i];c=Gt(c);let l=Bt(o,e),u=Wt(Ut(n,c),l)<0?-1:1;s[e*4]=c[0],s[e*4+1]=c[1],s[e*4+2]=c[2],s[e*4+3]=u}return s}function Ft(e,t,n){if(e.length===0)return[];let r=new Map;return t.forEach((e,t)=>{let n=r.get(e)??[];n.push(t),r.set(e,n)}),e.map(e=>{let t=[];for(let i of e.faceIndices){let a=r.get(i);a?t.push(...a):n({level:`info`,message:`GeomSubset '${e.name}' references hole/unknown face ${i}.`})}return{name:e.name,...e.material===void 0?{}:{material:e.material},triangles:Uint32Array.from(t)}})}function It(e,t,n){let r;switch(e.interpolation){case`constant`:r=0;break;case`uniform`:r=t.faceIndex;break;case`faceVarying`:r=t.cornerIndex;break;default:r=t.pointIndex}e.indices&&(r=e.indices[r]??0);let i=[];for(let t=0;t<n;t++)i.push(e.values[r*e.elementSize+t]??0);return i}function Lt(e,t,n,r){let i=[String(e)];i.push(Rt(t)),n&&i.push(Rt(n));for(let e of r)i.push(Rt(e));return i.join(`|`)}function Rt(e){return e.map(e=>Math.round(e*At)).join(`,`)}function zt(e,t,n){let r=[];for(let i=0;i<n;i++)r.push(e[t*n+i]??0);return r}function Bt(e,t){return[e[t*3],e[t*3+1],e[t*3+2]]}function Vt(e,t){return[e[t*2],e[t*2+1]]}function Ht(e,t){return[e[0]-t[0],e[1]-t[1],e[2]-t[2]]}function Ut(e,t){return[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]]}function Wt(e,t){return e[0]*t[0]+e[1]*t[1]+e[2]*t[2]}function Gt(e){let t=Math.hypot(e[0],e[1],e[2]);return t===0?[0,0,1]:[e[0]/t,e[1]/t,e[2]/t]}var Kt=class extends Error{name=`MaterialInstanceError`},qt={f:`f32`,i:`i32`,u:`u32`};function Jt(e,t){if(t===`f32`||t===`i32`||t===`u32`)return{name:e,wgslType:t,size:4,align:4,base:t,kind:`scalar`,components:1};let n=/^vec([234])([fiu])$/.exec(t);if(n){let r=Number(n[1]),i=qt[n[2]];return{name:e,wgslType:t,size:r===3?12:r*4,align:r===2?8:16,base:i,kind:`vec`,components:r}}let r=/^mat([34])x([34])f$/.exec(t);if(r){let n=Number(r[1]),i=Number(r[2]);return{name:e,wgslType:t,size:n*16,align:16,base:`f32`,kind:`mat`,components:n*i,cols:n,rows:i}}throw new Kt(`unsupported uniform type '${t}' for field '${e}'`)}function Yt(e,t){return Math.ceil(e/t)*t}function Xt(e){let t=[],n=0;for(let r of e){let e=Jt(r.name,r.wgslType),i=Yt(n,e.align);t.push({...e,offset:i}),n=i+e.size}return{fields:t,byteLength:e.length>0?Yt(n,16):0}}function Zt(e,t){return{pipelineKey:t,uniforms:Xt(e.uniforms.map(e=>({name:e.name,wgslType:e.wgslType}))),textures:e.textures.map(e=>e.name),samplers:e.samplers.map(e=>e.name)}}function Qt(e){return e.typeName===`Mesh`||e.typeName===void 0&&e.mesh!==void 0}function $t(e){return Qt(e)}function en(e,t,n){for(let r of e.references)if(r.assetPath===void 0&&r.primPath!==void 0){let e=n.get(r.primPath);if(e&&t(e))return e}}function tn(t,n={}){let r=n.isRenderable??$t,i=n.materials?.bindings,a=f(t,n.sink),o=new Map,s=e=>{let t=o.get(e);return t||(t={id:e,primPath:e},o.set(e,t)),t},c=[];for(let[n,o]of t.prims){let l=en(o,r,t.prims),u=l?l.path:r(o)?n:void 0;if(u===void 0)continue;let d=s(u),f=i?.get(n)?.materialPath??i?.get(u)?.materialPath;c.push({id:n,prototypeId:d.id,primPath:n,transform:a.get(n)??e,...f===void 0?{}:{materialPath:f}})}return{prototypes:[...o.values()],instances:c}}function nn(e){return Qt(e)}var rn=`weakerThanDescendants`;function an(e,t={}){let n=t.sink??(()=>void 0),r=t.isRenderable??nn,i=new Map;for(let t of e.materials)i.set(t.primPath,t);let a=new Map,o=[],s=new Map,c=(e,t)=>{let n=`${e.assetPath}::${e.referencedPrimPath}`,r=s.get(n);if(!r){let t=[];r={unit:{assetPath:e.assetPath,referencedPrimPath:e.referencedPrimPath,materialName:e.materialName,boundPrims:t},prims:t},s.set(n,r)}r.prims.includes(t)||r.prims.push(t)},l=(t,s,u)=>{let d=e.prims.get(t);if(!d)return;let f=d.materialBinding,p=f&&f.strength===`strongerThanDescendants`?f:void 0,m=s??f??u,h=s??p,g=f&&f.strength!==`strongerThanDescendants`?f:u;if(r(d)){if(m){let e=m.strength??rn,r=i.get(m.target);a.set(t,{primPath:t,materialPath:m.target,strength:e,...r===void 0?{}:{materialX:r}}),r?c(r,t):n({level:`info`,message:`Bound material has no MaterialX reference: ${m.target}`,detail:{prim:t}})}else o.push(t),n({level:`info`,message:`Gprim has no material binding: ${t}`})}for(let e of d.children)l(e,h,g)};for(let t of e.roots)l(t,void 0,void 0);return{bindings:a,units:[...s.values()].map(e=>e.unit).sort((e,t)=>`${e.assetPath}::${e.referencedPrimPath}`.localeCompare(`${t.assetPath}::${t.referencedPrimPath}`)),unbound:o}}var on=[`displacementshader`,`surfaceshader`,`volumeshader`];function sn(e){if(Array.isArray(e))return e;let t=[];for(let n=0;n<e.size();n++)t.push(e.get(n));return t}function cn(e,t,n){let r=e.getMaterialNode?.(t)??e.getChild?.(t)??null;if(r)return r;let i=e.getMaterialNodes?sn(e.getMaterialNodes()):[];if(i.length===0)return null;let a=t.toLowerCase(),o=i.find(e=>e.getName().toLowerCase()===a);if(o)return n({level:`info`,message:`MaterialX material matched case-insensitively: ${t} -> ${o.getName()}`}),o;if(i.length===1){let e=i[0];return n({level:`info`,message:`MaterialX material ${t} not found; using sole material ${e.getName()}`}),e}return null}function ln(e,t,n={}){let r=n.sink??(()=>void 0),i=cn(e,t,r);if(!i)return r({level:`error`,message:`MaterialX material not found: ${t}`}),[];let a=sn(i.getInputs()),o=[];for(let e of on){let n=a.find(t=>t.getName()===e);if(!n)continue;let i=n.getConnectedNode?.()??null;i?o.push({name:e,type:n.getType(),node:i}):r({level:`warning`,message:`Material terminal unconnected: ${t}.${e}`})}return o.length===0&&r({level:`warning`,message:`Material has no connected shader terminals: ${t}`}),o}function un(e){if(e.pendingMaterials.length>0)throw Error(`Material compilation failed: ${e.pendingMaterials.join(`, `)}`)}function dn(e,t){return`${e}::${t}`}function fn(e,t,n,r){return Ae({shaderHash:ke(r===void 0?t.code:`${t.code}\n${r}`),compilerVersion:n.compilerVersion??`0`,backend:n.backend??`raster`,pass:e.passes.map(e=>e.kind).sort().join(`+`)||`opaque`,layouts:[e.variantKey],vertexAttributes:e.attributes.map(e=>`${e.semantic}:${e.name}:${Ve(e.type)}`),colorFormats:n.colorFormats??[`rgba16float`],...n.depthFormat===void 0?{}:{depthFormat:n.depthFormat},sampleCount:n.sampleCount??1})}function pn(e){let{min:t,max:n}=e,r=[];for(let e=0;e<8;e++)r.push([e&1?n[0]:t[0],e&2?n[1]:t[1],e&4?n[2]:t[2]]);return r}function mn(e,t){let r=[1/0,1/0,1/0],i=[-1/0,-1/0,-1/0];for(let a of pn(e)){let e=n(t,a);for(let t=0;t<3;t++)e[t]<r[t]&&(r[t]=e[t]),e[t]>i[t]&&(i[t]=e[t])}return{min:r,max:i}}function hn(e){let t=n(e,[0,0,0]);return{min:[t[0],t[1],t[2]],max:[t[0],t[1],t[2]]}}function gn(e,t,n){let r=[{name:`position`,data:n.positions,components:3},{name:`normal`,data:n.normals,components:3}];n.uvs&&r.push({name:`uv`,data:n.uvs,components:2}),n.tangents&&r.push({name:`tangent`,data:n.tangents,components:4});for(let[e,t]of n.attributes)r.push({name:e,data:t.values,components:t.elementSize});let i,a={min:[1/0,1/0,1/0],max:[-1/0,-1/0,-1/0]};for(let e of n.indices)for(let t=0;t<3;t++){let r=n.positions[e*3+t];a.min[t]=Math.min(a.min[t],r),a.max[t]=Math.max(a.max[t],r)}return n.indices.length===0&&(a.min=[0,0,0],a.max=[0,0,0]),{prototypeId:e,primPath:t,streams:r,indices:n.indices,vertexCount:n.positions.length/3,triangleCount:n.indices.length/3,bounds:a,get blas(){return i??=ft(n.positions,n.indices)},subsets:n.subsets,subdivision:n.subdivision,displacement:n.displacement}}async function _n(e,t){let n=t.sink??(()=>void 0),r=an(e,{...t.sink?{sink:t.sink}:{},...t.isRenderable?{isRenderable:t.isRenderable}:{}}),i=tn(e,{...t.sink?{sink:t.sink}:{},materials:r,...t.isRenderable?{isRenderable:t.isRenderable}:{}}),a=new Map,o=[],s=0,c=0,l=0,u=!1,d=t.prepareOptions??{},f=e=>[`catmullClark`,`loop`,`bilinear`].includes(e.subdivisionScheme??`none`)&&(e.refinementLevel??0)>0,p=performance.now(),m=t.geometryCache,h=d.subdivider===void 0;if(!m&&h&&globalThis.indexedDB)try{m=await Ct()}catch(e){u=!0,n({level:`warning`,message:`Prepared geometry cache unavailable; preparing meshes without persistent caching.`,detail:String(e)})}for(let e of i.prototypes){let r=t.meshSource.meshFor(e.primPath);if(!r){o.push(e.id),n({level:`warning`,message:`Geometry pending: no mesh source for prototype ${e.primPath}`,detail:{prim:e.primPath}});continue}let i=h&&!f(r),p=i&&m?await Et(r,d):void 0;i&&m&&!p&&!u&&(u=!0,n({level:`warning`,message:`Web Crypto unavailable; prepared geometry will not be cached.`}));let g;if(p&&m)try{g=await m.get(p)}catch(e){u=!0,m=void 0,n({level:`warning`,message:`Failed to read prepared geometry cache; preparing meshes without persistent caching.`,detail:String(e)})}if(g)s++;else if(p&&m?c++:l++,g=jt(r,d),p&&m)try{await m.set(p,g)}catch(e){u=!0,m=void 0,n({level:`warning`,message:`Failed to persist prepared geometry.`,detail:String(e)})}a.set(e.id,gn(e.id,e.primPath,g))}let g=performance.now();performance.measure(`usd:geometry`,{start:p,end:g,detail:{geometries:a.size,cacheHits:s,cacheMisses:c,cacheBypasses:l,cacheUnavailable:u,triangles:[...a.values()].reduce((e,t)=>e+t.triangleCount,0)}});let _=new Map,v=[];for(let e of r.units){let r=dn(e.assetPath,e.referencedPrimPath),i=await t.materialCompiler.compile(e);if(!i){v.push(r),n({level:`warning`,message:`Material pending: compiler produced no build for ${e.materialName}`,detail:{material:r}});continue}let a=it(i.ir),o=i.layered?Ce(i.layered,{displacement:i.displacement!==void 0}):void 0,s=Zt(i.module,fn(a,i.module,t,o?.code));_.set(r,{unitKey:r,materialName:e.materialName,features:a,variant:s,boundPrims:e.boundPrims,...o?{sceneShader:o}:{},...i.layered?{surfaceModule:i.layered}:{},...i.graph?{surfaceGraph:i.graph}:{},...i.surface?{resolvedSurface:i.surface}:{},...i.displacement?{displacement:i.displacement}:{}})}let y=[],b=[];for(let e of i.instances){let t=a.get(e.prototypeId),n=r.bindings.get(e.primPath)??r.bindings.get(e.prototypeId),i=n?.materialX?dn(n.materialX.assetPath,n.materialX.referencedPrimPath):void 0;y.push({id:e.id,prototypeId:e.prototypeId,primPath:e.primPath,transform:e.transform,hasGeometry:t!==void 0,...i!==void 0&&_.has(i)?{materialKey:i}:{},...e.materialPath===void 0?{}:{materialPath:e.materialPath}}),b.push(t?mn(t.bounds,e.transform):hn(e.transform))}return{geometries:a,materials:_,instances:y,tlas:pt(b),pendingGeometry:o,pendingMaterials:v,unboundGprims:r.unbound}}function vn(e,t,n){let r=new Map;for(let i of t.streams){let t=e.createBuffer({size:i.data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST,...n?{label:`${n}:${i.name}`}:{}});e.queue.writeBuffer(t,0,i.data),r.set(i.name,t)}let i=e.createBuffer({size:t.indices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST,...n?{label:`${n}:index`}:{}});return e.queue.writeBuffer(i,0,t.indices),{vertexBuffers:r,indexBuffer:i,indexCount:t.indices.length}}var yn=new WeakMap;function bn(e){yn.delete(e)}function xn(e){let t=yn.get(e);return t||(t={textureView:e.createTexture({size:[1,1],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING}).createView(),sampler:e.createSampler(),cdf:e.createBuffer({size:16,usage:GPUBufferUsage.STORAGE})},yn.set(e,t)),t}function Sn(e,t,n,r){let i=t.surfaceModule,a=t.sceneShader?.frameGroup??3,o=new Map,s=(e,t)=>{let n=o.get(e)??[];n.push(t),o.set(e,n)};if((!i||i.uniforms.length>0)&&s(0,{binding:0,resource:{buffer:n.material}}),i){for(let e of i.textures){let t=n.textureViews?.get(e.name);t&&s(e.group,{binding:e.binding,resource:t})}for(let e of i.samplers){let t=n.samplers?.get(e.name);t&&s(e.group,{binding:e.binding,resource:t})}}s(a,{binding:0,resource:{buffer:n.frame}});let c=n.environment??xn(e);if(s(a,{binding:4,resource:c.textureView}),s(a,{binding:5,resource:c.sampler}),t.sceneShader?.rasterQuality!==`interactive`&&s(a,{binding:6,resource:{buffer:c.cdf}}),n.displacement){let e=n.displacement;s(e.group,{binding:1,resource:e.textureView}),s(e.group,{binding:2,resource:e.sampler}),s(e.group,{binding:3,resource:{buffer:e.params}})}let l=new Map;for(let[t,n]of o)l.set(t,e.createBindGroup({layout:r(t),entries:n}));return l.has(0)||l.set(0,e.createBindGroup({layout:r(0),entries:[]})),{materialBindGroup:l.get(0),frameBindGroup:l.get(a),byGroup:l}}var Cn=e=>{(e.level===`error`?console.error:e.level===`warning`?console.warn:console.info)(`[${e.level}] ${e.message}`,e.detail??``)},wn=class extends Error{name=`AbortError`;constructor(e=`Operation aborted.`){super(e)}};function Tn(e){if(e?.aborted)throw new wn}var En=`struct Closure {
  color: vec3f,
  weight: f32,
};
fn mx_closure_zero() -> Closure { return Closure(vec3f(0.0), 0.0); }
fn mx_closure_add(a: Closure, b: Closure) -> Closure { return Closure(a.color + b.color, min(a.weight + b.weight, 1.0)); }
// Scale a closure response and its reflectance by the modulation weight (T040).
fn mx_closure_mul(a: Closure, w: vec3f) -> Closure { return Closure(a.color * w, a.weight * clamp(dot(w, vec3f(0.2722287, 0.6740818, 0.0536895)), 0.0, 1.0)); }
fn mx_closure_mix(a: Closure, b: Closure, t: f32) -> Closure { return Closure(mix(a.color, b.color, t), mix(a.weight, b.weight, t)); }
// Energetic layering (T040): the base is coupled through the top's throughput
// (1 - top reflectance) and the combined coverage is composited, not maxed.
fn mx_layer(top: Closure, base: Closure) -> Closure {
  let t = clamp(top.weight, 0.0, 1.0);
  return Closure(top.color + base.color * (1.0 - t), t + base.weight * (1.0 - t));
}
fn mx_chiang_hair_bsdf(weight: f32, color: vec3f, roughness: vec2f) -> Closure { return Closure(color * weight, weight); }
// EDF emission (T040): emission adds radiance without blocking an underlying layer,
// so its reflectance (weight) is zero for the energetic composition.
fn mx_uniform_edf(color: vec3f) -> Closure { return Closure(color, 0.0); }
fn mx_generalized_schlick_edf(color0: vec3f, color90: vec3f, N: vec3f, V: vec3f) -> Closure {
  let NdotV = clamp(dot(N, V), 0.0, 1.0);
  let f = pow(1.0 - NdotV, 5.0);
  return Closure(color0 + (color90 - color0) * f, 0.0);
}
`,Dn=`const MX_MAX_LIGHTS: u32 = 4u;
struct MxLight {
  direction: vec4f,
  color: vec4f,
};
struct MxLighting {
  params: vec4f,
  lights: array<MxLight, MX_MAX_LIGHTS>,
};
@group(0) @binding(1) var<uniform> mxLighting: MxLighting;
`,On=`const MX_PI: f32 = 3.14159265359;
fn mx_ggx_ndf(NdotH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(MX_PI * d * d, 1e-7);
}
fn mx_smith_g1(NdotX: f32, a: f32) -> f32 {
  let a2 = a * a;
  return 2.0 * NdotX / max(NdotX + sqrt(a2 + (1.0 - a2) * NdotX * NdotX), 1e-7);
}
fn mx_fresnel_schlick(F0: vec3f, cosTheta: f32) -> vec3f {
  return F0 + (vec3f(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
fn mx_fresnel_schlick_f90(F0: vec3f, F90: vec3f, cosTheta: f32) -> vec3f {
  return F0 + (F90 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
fn mx_fresnel_conductor(n: vec3f, k: vec3f, cosTheta: f32) -> vec3f {
  let c = clamp(cosTheta, 0.0, 1.0);
  let c2 = c * c;
  let n2k2 = n * n + k * k;
  let two_nc = 2.0 * n * c;
  let rs = (n2k2 - two_nc + c2) / (n2k2 + two_nc + c2);
  let rp = (n2k2 * c2 - two_nc + 1.0) / (n2k2 * c2 + two_nc + 1.0);
  return clamp(0.5 * (rs + rp), vec3f(0.0), vec3f(1.0));
}
fn mx_sheen_ndf(NdotH: f32, r: f32) -> f32 {
  let inv = 1.0 / max(r, 1e-3);
  let sin2 = max(1.0 - NdotH * NdotH, 0.0);
  return (2.0 + inv) * pow(sin2, inv * 0.5) / (2.0 * MX_PI);
}
// GGX specular reflection integrand (f_r * NdotL, with NdotL folded against the 1/NdotL in f_r).
fn mx_ggx_reflection(F: vec3f, a: f32, N: vec3f, V: vec3f, L: vec3f) -> vec3f {
  let NdotL = max(dot(N, L), 0.0);
  let NdotV = max(dot(N, V), 0.0);
  if (NdotL <= 0.0 || NdotV <= 0.0) { return vec3f(0.0); }
  let H = normalize(L + V);
  let NdotH = max(dot(N, H), 0.0);
  let D = mx_ggx_ndf(NdotH, a);
  let G = mx_smith_g1(NdotL, a) * mx_smith_g1(NdotV, a);
  return F * (D * G / (4.0 * NdotV));
}
fn mx_oren_nayar_diffuse_bsdf(weight: f32, color: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let sigma2 = clamp(roughness, 0.0, 1.0) * clamp(roughness, 0.0, 1.0);
  let A = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);
  let B = 0.45 * sigma2 / (sigma2 + 0.09);
  let NdotV = max(dot(N, V), 1e-4);
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) { continue; }
    let s = dot(L, V) - dot(N, L) * dot(N, V);
    let t = select(1.0, max(NdotL, NdotV), s > 0.0);
    acc = acc + color * ((A + B * s / t) * NdotL / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_burley_diffuse_bsdf(weight: f32, color: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let NdotV = max(dot(N, V), 1e-4);
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) { continue; }
    let H = normalize(L + V);
    let LdotH = max(dot(L, H), 0.0);
    let fd90 = 0.5 + 2.0 * roughness * LdotH * LdotH;
    let fl = pow(1.0 - NdotL, 5.0);
    let fv = pow(1.0 - NdotV, 5.0);
    let fd = (1.0 + (fd90 - 1.0) * fl) * (1.0 + (fd90 - 1.0) * fv);
    acc = acc + color * (fd * NdotL / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_translucent_bsdf(weight: f32, color: vec3f, N: vec3f, V: vec3f) -> Closure {
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(-N, L), 0.0);
    acc = acc + color * (NdotL / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_dielectric_bsdf(weight: f32, tint: vec3f, ior: f32, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let a = max(roughness * roughness, 1e-3);
  let r = (ior - 1.0) / (ior + 1.0);
  let F0 = vec3f(clamp(r * r, 0.0, 1.0));
  let count = u32(mxLighting.params.x);
  var acc = tint * F0 * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let H = normalize(L + V);
    let VdotH = max(dot(V, H), 0.0);
    let F = mx_fresnel_schlick(F0, VdotH);
    acc = acc + tint * mx_ggx_reflection(F, a, N, V, L) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_conductor_bsdf(weight: f32, ior: vec3f, extinction: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let a = max(roughness * roughness, 1e-3);
  let count = u32(mxLighting.params.x);
  var acc = mx_fresnel_conductor(ior, extinction, 1.0) * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let H = normalize(L + V);
    let VdotH = max(dot(V, H), 0.0);
    let F = mx_fresnel_conductor(ior, extinction, VdotH);
    acc = acc + mx_ggx_reflection(F, a, N, V, L) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_generalized_schlick_bsdf(weight: f32, color0: vec3f, color90: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let a = max(roughness * roughness, 1e-3);
  let count = u32(mxLighting.params.x);
  var acc = color0 * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let H = normalize(L + V);
    let VdotH = max(dot(V, H), 0.0);
    let F = mx_fresnel_schlick_f90(color0, color90, VdotH);
    acc = acc + mx_ggx_reflection(F, a, N, V, L) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_sheen_bsdf(weight: f32, color: vec3f, roughness: f32, N: vec3f, V: vec3f) -> Closure {
  let r = clamp(roughness, 1e-3, 1.0);
  let NdotV = max(dot(N, V), 1e-4);
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL <= 0.0) { continue; }
    let H = normalize(L + V);
    let NdotH = max(dot(N, H), 0.0);
    let D = mx_sheen_ndf(NdotH, r);
    let vis = 1.0 / (4.0 * (NdotL + NdotV - NdotL * NdotV));
    acc = acc + color * (D * vis * NdotL) * radiance;
  }
  return Closure(acc * weight, weight);
}
fn mx_subsurface_bsdf(weight: f32, color: vec3f, radius: vec3f, N: vec3f, V: vec3f) -> Closure {
  let wrap = 0.5;
  let count = u32(mxLighting.params.x);
  var acc = color * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let wrapped = max((dot(N, L) + wrap) / (1.0 + wrap), 0.0);
    acc = acc + color * (wrapped / MX_PI) * radiance;
  }
  return Closure(acc * weight, weight);
}
// Anisotropic VDF (T040): raster single-scattering approximation at unit optical
// depth. Full volume transport is handled by the media integrator (path tracer)
// and the raster volume pass; a VDF composed as a surface closure here contributes
// single-scattered radiance with a Henyey-Greenstein phase and a single-scattering
// albedo scattering / (absorption + scattering).
fn mx_anisotropic_vdf(absorption: vec3f, scattering: vec3f, anisotropy: f32, V: vec3f) -> Closure {
  let extinction = max(absorption + scattering, vec3f(1e-4));
  let albedo = clamp(scattering / extinction, vec3f(0.0), vec3f(1.0));
  let g = clamp(anisotropy, -0.99, 0.99);
  let g2 = g * g;
  let count = u32(mxLighting.params.x);
  var acc = albedo * mxLighting.params.yzw;
  for (var i = 0u; i < count; i = i + 1u) {
    let L = normalize(-mxLighting.lights[i].direction.xyz);
    let radiance = mxLighting.lights[i].color.rgb * mxLighting.lights[i].direction.w;
    let cosTheta = dot(-L, V);
    let denom = pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);
    let phase = (1.0 - g2) / (4.0 * MX_PI * denom);
    acc = acc + albedo * phase * radiance;
  }
  let w = clamp(dot(albedo, vec3f(0.2722287, 0.6740818, 0.0536895)), 0.0, 1.0);
  return Closure(acc, w);
}
`,kn=`struct BSDF {
  response: vec3f,
  throughput: vec3f,
};
fn mx_surface(bsdf: Closure, edf: Closure, opacity: f32) -> Closure {
  var result: BSDF;
  result.response = bsdf.color + edf.color;
  result.throughput = max(vec3f(1.0) - vec3f(bsdf.weight), vec3f(0.0));
  return Closure(result.response, opacity);
}
`,An=new Set([`oren_nayar_diffuse_bsdf`,`burley_diffuse_bsdf`,`translucent_bsdf`,`dielectric_bsdf`,`conductor_bsdf`,`generalized_schlick_bsdf`,`sheen_bsdf`,`subsurface_bsdf`,`anisotropic_vdf`]);function jn(e){return An.has(e)}var Mn=`fn mx_luminance(c: vec3f) -> vec3f {
  let l = dot(c, vec3f(0.2722287, 0.6740818, 0.0536895));
  return vec3f(l);
}
`,Nn=`fn mx_rgbtohsv(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let d = mx - mn;
  var h = 0.0;
  if (d > 0.0) {
    if (mx == c.r) { h = (c.g - c.b) / d; }
    else if (mx == c.g) { h = 2.0 + (c.b - c.r) / d; }
    else { h = 4.0 + (c.r - c.g) / d; }
    h = fract(h / 6.0);
  }
  let s = select(0.0, d / mx, mx > 0.0);
  return vec3f(h, s, mx);
}
fn mx_hsvtorgb(c: vec3f) -> vec3f {
  let h = c.x * 6.0;
  let s = c.y;
  let v = c.z;
  let i = floor(h);
  let f = h - i;
  let p = v * (1.0 - s);
  let q = v * (1.0 - s * f);
  let t = v * (1.0 - s * (1.0 - f));
  let m = i32(i) % 6;
  switch (m) {
    case 0 { return vec3f(v, t, p); }
    case 1 { return vec3f(q, v, p); }
    case 2 { return vec3f(p, v, t); }
    case 3 { return vec3f(p, q, v); }
    case 4 { return vec3f(t, p, v); }
    default { return vec3f(v, p, q); }
  }
}
`,Pn=`fn mx_rotate2d(v: vec2f, deg: f32) -> vec2f {
  let a = radians(deg);
  let c = cos(a);
  let s = sin(a);
  return vec2f(c * v.x + s * v.y, -s * v.x + c * v.y);
}
`,Fn=`fn mx_rotate3d(v: vec3f, deg: f32, axis: vec3f) -> vec3f {
  let a = radians(deg);
  let n = normalize(axis);
  let c = cos(a);
  let s = sin(a);
  return v * c + cross(n, v) * s + n * dot(n, v) * (1.0 - c);
}
`,In=`fn mx_normalmap(sample: vec3f, scale: vec2f, N: vec3f, T: vec3f, B: vec3f) -> vec3f {
  let m = select(sample * 2.0 - 1.0, vec3f(0.0, 0.0, 1.0), dot(sample, sample) == 0.0);
  let v = vec3f(m.xy * scale, m.z);
  return normalize(T * v.x + B * v.y + N * v.z);
}
`,Ln=`fn mx_hash3(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}
fn mx_fractal3d(p: vec3f, amplitude: f32, octaves: f32) -> f32 {
  var sum = 0.0;
  var amp = amplitude;
  var freq = 1.0;
  let n = i32(octaves);
  for (var i = 0; i < n; i = i + 1) {
    sum = sum + mx_hash3(p * freq) * amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  return sum;
}
`,Rn=`fn mx_hash_u32(x: u32) -> u32 {
  var h = x;
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}
fn mx_hash_cell(c: vec3i, seed: u32) -> u32 {
  return mx_hash_u32(bitcast<u32>(c.x) ^ mx_hash_u32(bitcast<u32>(c.y) ^ mx_hash_u32(bitcast<u32>(c.z) ^ mx_hash_u32(seed))));
}
fn mx_cell_float(c: vec3i, seed: u32) -> f32 {
  return f32(mx_hash_cell(c, seed) >> 8u) / 16777216.0;
}
fn mx_grad3(h: u32, d: vec3f) -> f32 {
  let k = h & 15u;
  let u = select(d.y, d.x, k < 8u);
  let v = select(select(d.z, d.x, k == 12u || k == 14u), d.y, k < 4u);
  return select(-u, u, (k & 1u) == 0u) + select(-v, v, (k & 2u) == 0u);
}
fn mx_perlin3(p: vec3f, seed: u32) -> f32 {
  let fl = floor(p);
  let i = vec3i(fl);
  let f = p - fl;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = mx_grad3(mx_hash_cell(i, seed), f);
  let n100 = mx_grad3(mx_hash_cell(i + vec3i(1, 0, 0), seed), f - vec3f(1.0, 0.0, 0.0));
  let n010 = mx_grad3(mx_hash_cell(i + vec3i(0, 1, 0), seed), f - vec3f(0.0, 1.0, 0.0));
  let n110 = mx_grad3(mx_hash_cell(i + vec3i(1, 1, 0), seed), f - vec3f(1.0, 1.0, 0.0));
  let n001 = mx_grad3(mx_hash_cell(i + vec3i(0, 0, 1), seed), f - vec3f(0.0, 0.0, 1.0));
  let n101 = mx_grad3(mx_hash_cell(i + vec3i(1, 0, 1), seed), f - vec3f(1.0, 0.0, 1.0));
  let n011 = mx_grad3(mx_hash_cell(i + vec3i(0, 1, 1), seed), f - vec3f(0.0, 1.0, 1.0));
  let n111 = mx_grad3(mx_hash_cell(i + vec3i(1, 1, 1), seed), f - vec3f(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);
  return 0.982 * mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
fn mx_perlin3v(p: vec3f) -> vec3f {
  return vec3f(mx_perlin3(p, 0u), mx_perlin3(p, 1u), mx_perlin3(p, 2u));
}
fn mx_fractal3(p: vec3f, octaves: i32, lacunarity: f32, diminish: f32, seed: u32) -> f32 {
  var result = 0.0;
  var amp = 1.0;
  var q = p;
  let n = clamp(octaves, 0, 16);
  for (var i = 0; i < n; i = i + 1) {
    result = result + amp * mx_perlin3(q, seed);
    amp = amp * diminish;
    q = q * lacunarity;
  }
  return result;
}
fn mx_fractal3v(p: vec3f, octaves: i32, lacunarity: f32, diminish: f32) -> vec3f {
  return vec3f(mx_fractal3(p, octaves, lacunarity, diminish, 0u), mx_fractal3(p, octaves, lacunarity, diminish, 1u), mx_fractal3(p, octaves, lacunarity, diminish, 2u));
}
fn mx_cellnoise3(p: vec3f) -> f32 {
  return mx_cell_float(vec3i(floor(p)), 0u);
}
`,zn=`fn mx_worley_cell_color(cell: vec3i, dims: i32) -> vec3f {
  if (dims == 2) {
    return vec3f(f32(mx_unified_hash(vec3i(cell.xy, 0), 3)), f32(mx_unified_hash(vec3i(cell.xy, 1), 3)), f32(mx_unified_hash(vec3i(cell.xy, 2), 3))) / 4294967295.0;
  }
  let seed = 0xdeadbeefu + 16u + 13u;
  var a = seed + bitcast<u32>(cell.x);
  var b = seed + bitcast<u32>(cell.y);
  var c = seed + bitcast<u32>(cell.z);
  a = (a - c) ^ mx_noise_rotl(c, 4u); c = c + b;
  b = (b - a) ^ mx_noise_rotl(a, 6u); a = a + c;
  c = (c - b) ^ mx_noise_rotl(b, 8u); b = b + a;
  a = (a - c) ^ mx_noise_rotl(c, 16u); c = c + b;
  b = (b - a) ^ mx_noise_rotl(a, 19u); a = a + c;
  c = (c - b) ^ mx_noise_rotl(b, 4u); b = b + a;
  return vec3f(f32(mx_noise_final(a, b, c)), f32(mx_noise_final(a + 1u, b, c)), f32(mx_noise_final(a + 2u, b, c))) / 4294967295.0;
}
fn mx_worley(p: vec3f, jitter: f32, dims: i32, style: i32, channels: i32) -> vec3f {
  let fl = floor(p);
  let base = vec3i(fl);
  let f = p - fl;
  var d = vec3f(1e6);
  var nearest = base;
  let zr = select(0, 1, dims == 3);
  for (var x = -1; x <= 1; x = x + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var z = -zr; z <= zr; z = z + 1) {
        let o = vec3i(x, y, z);
        let c = base + o;
        let r = mx_worley_cell_color(c, dims);
        let cellpos = vec3f(o) + vec3f(0.5) + (r - vec3f(0.5)) * jitter;
        var diff = cellpos - f;
        if (dims == 2) { diff.z = 0.0; }
        let dist = dot(diff, diff);
        if (dist < d.x) {
          d = vec3f(dist, d.x, d.y);
          nearest = vec3i(floor(cellpos + fl));
        }
        else if (dist < d.y) { d = vec3f(d.x, dist, d.y); }
        else if (dist < d.z) { d.z = dist; }
      }
    }
  }
  if (style == 1) {
    if (channels == 1) { return vec3f(f32(mx_unified_hash(nearest, dims)) / 4294967295.0); }
    return mx_worley_cell_color(nearest, dims);
  }
  return sqrt(d);
}
`,Bn=`fn mx_noise_rotl(x: u32, k: u32) -> u32 {
  return (x << k) | (x >> (32u - k));
}
fn mx_noise_final(a0: u32, b0: u32, c0: u32) -> u32 {
  var a = a0;
  var b = b0;
  var c = c0;
  c = (c ^ b) - mx_noise_rotl(b, 14u);
  a = (a ^ c) - mx_noise_rotl(c, 11u);
  b = (b ^ a) - mx_noise_rotl(a, 25u);
  c = (c ^ b) - mx_noise_rotl(b, 16u);
  a = (a ^ c) - mx_noise_rotl(c, 4u);
  b = (b ^ a) - mx_noise_rotl(a, 14u);
  c = (c ^ b) - mx_noise_rotl(b, 24u);
  return c;
}
fn mx_unified_hash(cell: vec3i, dims: i32) -> u32 {
  let seed = 0xdeadbeefu + u32(dims) * 4u + 13u;
  return mx_noise_final(seed + bitcast<u32>(cell.x), seed + bitcast<u32>(cell.y), seed + select(0u, bitcast<u32>(cell.z), dims == 3));
}
`,Vn=`fn mx_unified_cell(p: vec3f, dims: i32) -> f32 {
  return f32(mx_unified_hash(vec3i(floor(p)), dims)) / 4294967295.0;
}
fn mx_unified_perlin3(p: vec3f) -> f32 {
  let fl = floor(p);
  let cell = vec3i(fl);
  let f = p - fl;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var result = 0.0;
  for (var z = 0; z <= 1; z = z + 1) {
    for (var y = 0; y <= 1; y = y + 1) {
      for (var x = 0; x <= 1; x = x + 1) {
        let corner = vec3i(x, y, z);
        let w = mix(vec3f(1.0) - u, u, vec3f(corner));
        result = result + w.x * w.y * w.z * mx_grad3(mx_unified_hash(cell + corner, 3), f - vec3f(corner));
      }
    }
  }
  return 0.982 * result;
}
fn mx_unified_fractal3(p: vec3f, octaves: i32, lacunarity: f32, diminish: f32) -> f32 {
  var result = 0.0;
  var amplitude = 1.0;
  var q = p;
  for (var i = 0; i < octaves; i = i + 1) {
    result = result + amplitude * mx_unified_perlin3(q);
    amplitude = amplitude * diminish;
    q = q * lacunarity;
  }
  return result;
}
fn mx_unifiednoise(p: vec3f, dims: i32, jitter: f32, octaves: i32, lacunarity: f32, diminish: f32, kind: i32, style: i32) -> f32 {
  let angle = (jitter - 1.0) * 90000.0;
  var q = mx_rotate3d(p, angle, vec3f(0.1, 1.0, 0.0));
  if (dims == 2) { q = vec3f(mx_rotate2d(p.xy, angle), 0.0); }
  switch (kind) {
    case 1 { return mx_unified_cell(q, dims); }
    case 2 { return mx_worley(p, jitter, dims, style, 1).x; }
    case 3 {
      return mx_unified_fractal3(select(q, vec3f(p.xy, angle), dims == 2), octaves, lacunarity, diminish);
    }
    default { return mx_perlin3(q, 0u) * 0.5 + 0.5; }
  }
}
`,Hn=`fn mx_inverse3(m: mat3x3f) -> mat3x3f {
  let r0 = cross(m[1], m[2]);
  let r1 = cross(m[2], m[0]);
  let r2 = cross(m[0], m[1]);
  let det = dot(m[0], r0);
  let inv = 1.0 / select(det, 1e-8, abs(det) < 1e-8);
  return transpose(mat3x3f(r0, r1, r2)) * inv;
}
fn mx_inverse4(m: mat4x4f) -> mat4x4f {
  let a00 = m[0][0]; let a01 = m[0][1]; let a02 = m[0][2]; let a03 = m[0][3];
  let a10 = m[1][0]; let a11 = m[1][1]; let a12 = m[1][2]; let a13 = m[1][3];
  let a20 = m[2][0]; let a21 = m[2][1]; let a22 = m[2][2]; let a23 = m[2][3];
  let a30 = m[3][0]; let a31 = m[3][1]; let a32 = m[3][2]; let a33 = m[3][3];
  let b00 = a00 * a11 - a01 * a10;
  let b01 = a00 * a12 - a02 * a10;
  let b02 = a00 * a13 - a03 * a10;
  let b03 = a01 * a12 - a02 * a11;
  let b04 = a01 * a13 - a03 * a11;
  let b05 = a02 * a13 - a03 * a12;
  let b06 = a20 * a31 - a21 * a30;
  let b07 = a20 * a32 - a22 * a30;
  let b08 = a20 * a33 - a23 * a30;
  let b09 = a21 * a32 - a22 * a31;
  let b10 = a21 * a33 - a23 * a31;
  let b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  let inv = 1.0 / select(det, 1e-8, abs(det) < 1e-8);
  return mat4x4f(
    a11 * b11 - a12 * b10 + a13 * b09, a02 * b10 - a01 * b11 - a03 * b09, a31 * b05 - a32 * b04 + a33 * b03, a22 * b04 - a21 * b05 - a23 * b03,
    a12 * b08 - a10 * b11 - a13 * b07, a00 * b11 - a02 * b08 + a03 * b07, a32 * b02 - a30 * b05 - a33 * b01, a20 * b05 - a22 * b02 + a23 * b01,
    a10 * b10 - a11 * b08 + a13 * b06, a01 * b08 - a00 * b10 - a03 * b06, a30 * b04 - a31 * b02 + a33 * b00, a21 * b02 - a20 * b04 - a23 * b00,
    a11 * b07 - a10 * b09 - a12 * b06, a00 * b09 - a01 * b07 + a02 * b06, a31 * b01 - a30 * b03 - a32 * b00, a20 * b03 - a21 * b01 + a22 * b00) * inv;
}
`,Un=`fn mx_place2d(tc: vec2f, pivot: vec2f, scale: vec2f, rotate: f32, offset: vec2f, order: i32) -> vec2f {
  let a = radians(rotate);
  let c = cos(a);
  let s = sin(a);
  let rot = mat2x2f(c, -s, s, c);
  let centered = tc - pivot;
  if (order == 0) { return rot * (centered / scale) - offset + pivot; }
  return (rot * (centered - offset)) / scale + pivot;
}
`,Wn=`fn mx_blackbody(temperature: f32) -> vec3f {
  let k = clamp(temperature, 800.0, 25000.0);
  let t = 1000.0 / k;
  let t2 = t * t;
  let t3 = t2 * t;
  var xc = -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t + 0.240390;
  if (k < 4000.0) { xc = -0.2661239 * t3 - 0.2343580 * t2 + 0.8776956 * t + 0.179910; }
  let xc2 = xc * xc;
  let xc3 = xc2 * xc;
  var yc = 3.0817580 * xc3 - 5.87338670 * xc2 + 3.75112997 * xc - 0.37001483;
  if (k < 2222.0) { yc = -1.1063814 * xc3 - 1.34811020 * xc2 + 2.18555832 * xc - 0.20219683; }
  else if (k < 4000.0) { yc = -0.9549476 * xc3 - 1.37418593 * xc2 + 2.09137015 * xc - 0.16748867; }
  if (yc <= 0.0) { return vec3f(1.0); }
  let xyz = vec3f(xc / yc, 1.0, (1.0 - xc - yc) / yc);
  let m = mat3x3f(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570);
  return max(m * xyz, vec3f(0.0));
}
`,Gn=`fn mx_heighttonormal(dh: vec2f, du: vec2f, dv: vec2f, scale: f32) -> vec3f {
  let h = dh * scale * (1.0 / 16.0);
  var n = cross(vec3f(du.x, dv.x, h.x), vec3f(du.y, dv.y, h.y));
  if (dot(n, n) < 1e-12) { n = vec3f(0.0, 0.0, 1.0); }
  else if (n.z < 0.0) { n = -n; }
  return normalize(n) * 0.5 + 0.5;
}
`,Kn=`fn mx_ramp_gradient(x: f32, i1: f32, i2: f32, c1: vec4f, c2: vec4f, interpolation: i32, prev: vec4f, num: i32, count: i32) -> vec4f {
  if (num > count || !(x > i1)) { return prev; }
  if (interpolation >= 2) { return select(c2, c1, i2 > x); }
  let t = select((clamp(x, i1, i2) - i1) / (i2 - i1), smoothstep(i1, i2, x), interpolation == 1);
  return mix(c1, c2, t);
}
fn mx_ramp_x(uv: vec2f, kind: i32) -> f32 {
  let d = uv - vec2f(0.5);
  switch (kind) {
    case 1 { return atan2(d.x, d.y) / 6.28319 + 0.5; }
    case 2 { return length(d * 1.414); }
    case 3 { return 2.0 * max(abs(d.x), abs(d.y)); }
    default { return uv.x; }
  }
}
`,qn=`fn mx_colorcorrect(c: vec3f, hue: f32, saturation: f32, gamma: f32, lift: f32, gain: f32, contrast: f32, pivot: f32, exposure: f32) -> vec3f {
  let hsv = mx_rgbtohsv(c);
  var r = mx_hsvtorgb(vec3f(fract(hsv.x + hue), hsv.y * saturation, hsv.z));
  r = sign(r) * pow(abs(r), vec3f(1.0 / max(gamma, 1e-4)));
  r = r * (1.0 - lift) + vec3f(lift);
  r = r * gain;
  r = (r - vec3f(pivot)) * contrast + vec3f(pivot);
  return r * exp2(exposure);
}
`,Jn=`fn mx_artistic_ior(reflectivity: vec3f, edge_color: vec3f) -> vec3f {
  let r = clamp(reflectivity, vec3f(0.0), vec3f(0.99));
  let s = sqrt(r);
  let nMin = (1.0 - r) / (1.0 + r);
  let nMax = (1.0 + s) / (1.0 - s);
  return mix(nMax, nMin, edge_color);
}
fn mx_artistic_ior_extinction(reflectivity: vec3f, edge_color: vec3f) -> vec3f {
  let r = clamp(reflectivity, vec3f(0.0), vec3f(0.99));
  let ior = mx_artistic_ior(reflectivity, edge_color);
  let np1 = ior + 1.0;
  let nm1 = ior - 1.0;
  return sqrt(max((np1 * np1 * r - nm1 * nm1) / (1.0 - r), vec3f(0.0)));
}
`,Yn=`fn mx_roughness_anisotropy(roughness: f32, anisotropy: f32) -> vec2f {
  let r2 = roughness * roughness;
  let a = clamp(anisotropy, 0.0, 1.0);
  return vec2f(r2 / max(1.0 - a * 0.9, 1e-3), r2 * (1.0 - a * 0.9));
}
`,Xn=`fn mx_roughness_dual(roughness: vec2f) -> vec2f { return roughness * roughness; }
`,Zn=`fn mx_chiang_hair_absorption_from_color(color: vec3f) -> vec3f {
  let c = clamp(color, vec3f(1e-4), vec3f(1.0));
  let l = log(c);
  return l * l;
}
fn mx_chiang_hair_roughness(longitudinal: f32, azimuthal: f32) -> vec2f {
  return vec2f(longitudinal * longitudinal, azimuthal * azimuthal);
}
fn mx_deon_hair_absorption_from_melanin(eumelanin: f32, pheomelanin: f32) -> vec3f {
  return eumelanin * vec3f(0.419, 0.697, 1.37) + pheomelanin * vec3f(0.187, 0.4, 1.05);
}
`,Qn=e=>t=>`(${t.named(`in1`,void 0,0)} ${e} ${t.named(`in2`,void 0,1)})`,F=e=>t=>`${e}(${t.named(`in`,void 0,0)})`,$n=e=>t=>`${e}(${t.named(`in1`,void 0,0)}, ${t.named(`in2`,void 0,1)})`,er=e=>(t,n,r)=>{let i=t.named(`in2`,void 0,1),a=t.typeOf(`in2`),o=n.kind===`vector`&&a!==void 0&&a.kind===`scalar`?`${r.wgslType(n)}(${i})`:i;return`${e}(${t.named(`in1`,void 0,0)}, ${o})`};function tr(e,t){return e.kind===`scalar`&&e.scalar===`bool`?`false`:e.kind===`matrix`?`${t.wgslType(e)}()`:`${t.wgslType(e)}(0)`}function nr(e){return e.kind===`vector`?e.size:1}function rr(e,t,n){switch(nr(e)){case 1:return t(`0u`);case 2:return`(${n}).xy`;case 3:return n;default:return`vec4f(${n}, ${t(`3u`)})`}}var ir=(e,t)=>e.named(`texcoord`,t.varyings.texcoord),ar=(e,t)=>e.named(`position`,t.varyings.position),or=e=>(t,n,r)=>{let i=r.wgslType(n),a=t.named(`fg`,`${i}(0.0)`),o=t.named(`bg`,`${i}(0.0)`);return`mix(${o}, ${e(a,o,i)}, ${t.named(`mix`,`1.0`)})`},sr=e=>(t,n)=>{let r=`${t.named(`value1`,void 0,0)} ${e} ${t.named(`value2`,void 0,1)}`;return n.kind===`scalar`&&n.scalar===`bool`&&!t.has(`in1`)?`(${r})`:`select(${t.named(`in2`,void 0,3)}, ${t.named(`in1`,void 0,2)}, ${r})`};function I(e,t,n){return n===void 0?{category:e,kind:`expr`,emit:t}:{category:e,kind:`expr`,emit:t,prelude:n}}function cr(e,t,n){return n===void 0?{category:e,kind:`closure`,emit:t}:{category:e,kind:`closure`,emit:t,prelude:n}}var lr=[I(`absval`,F(`abs`)),I(`fract`,F(`fract`)),I(`add`,Qn(`+`)),I(`subtract`,Qn(`-`)),I(`multiply`,Qn(`*`)),I(`divide`,Qn(`/`)),I(`power`,er(`pow`)),I(`sin`,F(`sin`)),I(`sqrt`,F(`sqrt`)),I(`ln`,(e,t,n)=>{let r=e.named(`in`,void 0,0),i=n.wgslType(t),a=`${r} > ${i}(0.0)`;return`select(${i}(0.0), log(select(${i}(1.0), ${r}, ${a})), ${a})`}),I(`sign`,F(`sign`)),I(`normalize`,F(`normalize`)),I(`min`,er(`min`)),I(`max`,er(`max`)),I(`clamp`,(e,t,n)=>{let r=n.wgslType(t);return`clamp(${e.named(`in`,void 0,0)}, ${r}(${e.named(`low`,`0.0`,1)}), ${r}(${e.named(`high`,`1.0`,2)}))`}),I(`range`,(e,t,n)=>{let r=n.wgslType(t),i=`${r}(${e.named(`inlow`,`0.0`,1)})`,a=`${r}(${e.named(`inhigh`,`1.0`,2)})`,o=`${r}(${e.named(`outlow`,`0.0`,3)})`,s=`${r}(${e.named(`outhigh`,`1.0`,4)})`,c=`${r}(${e.named(`gamma`,`1.0`,5)})`,l=`((${e.named(`in`,void 0,0)} - ${i}) / (${a} - ${i}))`,u=`(${o} + (${s} - ${o}) * ${`(sign(${l}) * pow(abs(${l}), ${r}(1.0) / ${c}))`})`;return`select(${u}, clamp(${u}, min(${o}, ${s}), max(${o}, ${s})), ${e.named(`doclamp`,`false`,6)})`}),I(`dotproduct`,$n(`dot`)),I(`dot`,e=>e.named(`in`,void 0,0)),I(`invert`,e=>`(${e.named(`amount`,`1.0`,1)} - ${e.named(`in`,void 0,0)})`),I(`mix`,e=>`mix(${e.named(`bg`,void 0,1)}, ${e.named(`fg`,void 0,0)}, ${e.named(`mix`,void 0,2)})`),I(`extract`,e=>`${e.named(`in`,void 0,0)}[${e.named(`index`,void 0,1)}]`),I(`combine2`,e=>`vec2f(${e.named(`in1`,void 0,0)}, ${e.named(`in2`,void 0,1)})`),I(`combine3`,e=>`vec3f(${e.named(`in1`,void 0,0)}, ${e.named(`in2`,void 0,1)}, ${e.named(`in3`,void 0,2)})`),I(`combine4`,e=>`vec4f(${e.named(`in1`,`0.0`)}, ${e.named(`in2`,`0.0`)}, ${e.named(`in3`,`0.0`)}, ${e.named(`in4`,`0.0`)})`),I(`constant`,e=>e.named(`value`,void 0,0)),I(`ifequal`,sr(`==`)),I(`ifgreater`,sr(`>`)),I(`ifgreatereq`,sr(`>=`)),I(`switch`,(e,t,n)=>{let r=10;for(;r>1&&!e.has(`in${r}`);)r--;let i=tr(t,n),a=`clamp(i32(floor(f32(${e.named(`which`,`0.0`)}))), 0, ${r-1})`,o=e.named(`in${r}`,i);for(let t=r-1;t>=1;t--)o=`select(${o}, ${e.named(`in${t}`,i)}, ${a} == ${t-1})`;return o}),I(`and`,e=>`(${e.named(`in1`,`false`)} && ${e.named(`in2`,`false`)})`),I(`or`,e=>`(${e.named(`in1`,`false`)} || ${e.named(`in2`,`false`)})`),I(`xor`,e=>`(${e.named(`in1`,`false`)} != ${e.named(`in2`,`false`)})`),I(`not`,e=>`(!${e.named(`in`,`false`)})`),I(`cos`,F(`cos`)),I(`tan`,F(`tan`)),I(`asin`,F(`asin`)),I(`acos`,(e,t,n)=>{let r=e.named(`in`,void 0,0),i=n.wgslType(t);return`select(${i}(0.0), acos(clamp(${r}, ${i}(-1.0), ${i}(1.0))), abs(${r}) <= ${i}(1.0))`}),I(`atan2`,e=>`atan2(${e.named(`iny`)}, ${e.named(`inx`)})`),I(`exp`,F(`exp`)),I(`floor`,F(`floor`)),I(`ceil`,F(`ceil`)),I(`round`,F(`round`)),I(`magnitude`,F(`length`)),I(`distance`,$n(`distance`)),I(`crossproduct`,$n(`cross`)),I(`reflect`,(e,t,n)=>`reflect(${e.named(`in`)}, ${e.named(`normal`,n.varyings.normal)})`),I(`refract`,(e,t,n)=>`refract(${e.named(`in`)}, ${e.named(`normal`,n.varyings.normal)}, ${e.named(`ior`,`1.0`)})`),I(`modulo`,e=>{let t=e.named(`in1`),n=e.named(`in2`,`1.0`);return`(${t} - ${n} * floor(${t} / ${n}))`}),I(`safepower`,(e,t,n)=>{let r=e.named(`in1`);return`(sign(${r}) * pow(abs(${r}), ${n.wgslType(t)}(${e.named(`in2`,`1.0`)})))`}),I(`smoothstep`,(e,t,n)=>{let r=n.wgslType(t),i=`${r}(${e.named(`low`,`0.0`)})`,a=`${r}(${e.named(`high`,`1.0`)})`,o=e.named(`in`),s=`clamp((${o} - ${i}) / ${`select(${r}(1.0), ${a} - ${i}, ${a} > ${i})`}, ${r}(0.0), ${r}(1.0))`;return`select(select(${`(${s} * ${s} * (${r}(3.0) - ${r}(2.0) * ${s}))`}, ${r}(0.0), ${o} <= ${i}), ${r}(1.0), ${o} >= ${a})`}),I(`remap`,(e,t,n)=>{let r=n.wgslType(t),i=`${r}(${e.named(`inlow`,`0.0`)})`,a=`${r}(${e.named(`inhigh`,`1.0`)})`,o=`${r}(${e.named(`outlow`,`0.0`)})`,s=`${r}(${e.named(`outhigh`,`1.0`)})`,c=`${a} == ${i}`,l=`select(${a} - ${i}, ${r}(1.0), ${c})`;return`select(${`(${o} + ${`((${e.named(`in`)} - ${i}) / ${l})`} * (${s} - ${o}))`}, ${o}, ${c})`}),I(`creatematrix`,(e,t)=>{let n=e.named(`in1`),r=e.named(`in2`),i=e.named(`in3`);if(t.kind===`matrix`&&t.size===4){let a=e.named(`in4`);return nr(e.typeOf(`in1`)??t)===3?`mat4x4f(vec4f(${n}, 0.0), vec4f(${r}, 0.0), vec4f(${i}, 0.0), vec4f(${a}, 1.0))`:`mat4x4f(${n}, ${r}, ${i}, ${a})`}return`mat3x3f(${n}, ${r}, ${i})`}),I(`determinant`,F(`determinant`)),I(`transpose`,F(`transpose`)),I(`invertmatrix`,(e,t)=>`${t.kind===`matrix`&&t.size===4?`mx_inverse4`:`mx_inverse3`}(${e.named(`in`)})`,Hn),I(`transformmatrix`,(e,t)=>{let n=e.named(`mat`),r=e.named(`in`),i=e.typeOf(`mat`),a=nr(t);return a===2?`(${n} * vec3f(${r}, 1.0)).xy`:a===3&&i?.kind===`matrix`&&i.size===4?`(${n} * vec4f(${r}, 1.0)).xyz`:`(${n} * ${r})`}),I(`transformpoint`,e=>e.named(`in`)),I(`transformvector`,e=>e.named(`in`)),I(`transformnormal`,e=>`normalize(${e.named(`in`)})`),I(`plus`,or((e,t)=>`(${t} + ${e})`)),I(`minus`,or((e,t)=>`(${t} - ${e})`)),I(`difference`,or((e,t)=>`abs(${t} - ${e})`)),I(`screen`,or((e,t,n)=>`(${n}(1.0) - (${n}(1.0) - ${e}) * (${n}(1.0) - ${t}))`)),I(`overlay`,or((e,t,n)=>`select(${n}(1.0) - 2.0 * (${n}(1.0) - ${e}) * (${n}(1.0) - ${t}), 2.0 * ${e} * ${t}, ${e} < ${n}(0.5))`)),I(`burn`,or((e,t,n)=>`select(${n}(1.0) - (${n}(1.0) - ${t}) / ${e}, ${n}(0.0), abs(${e}) < ${n}(1e-6))`)),I(`dodge`,or((e,t,n)=>`select(${t} / (${n}(1.0) - ${e}), ${n}(0.0), abs(${n}(1.0) - ${e}) < ${n}(1e-6))`)),I(`premult`,e=>`vec4f(${e.named(`in`)}.rgb * ${e.named(`in`)}.a, ${e.named(`in`)}.a)`),I(`unpremult`,e=>{let t=e.named(`in`);return`vec4f(${t}.rgb / select(${t}.a, 1.0, ${t}.a == 0.0), ${t}.a)`}),I(`contrast`,e=>{let t=e.named(`pivot`,`0.5`);return`((${e.named(`in`)} - ${t}) * ${e.named(`amount`,`1.0`)} + ${t})`}),I(`saturate`,(e,t)=>{let n=e.named(`in`),r=nr(t)===4?`${n}.rgb`:n,i=`mix(vec3f(dot(${r}, ${e.named(`lumacoeffs`,`vec3f(0.2722287, 0.6740818, 0.0536895)`)})), ${r}, ${e.named(`amount`,`1.0`)})`;return nr(t)===4?`vec4f(${i}, ${n}.a)`:i}),I(`colorcorrect`,(e,t)=>{let n=e.named(`in`),r=`mx_colorcorrect(${nr(t)===4?`${n}.rgb`:n}, ${[e.named(`hue`,`0.0`),e.named(`saturation`,`1.0`),e.named(`gamma`,`1.0`),e.named(`lift`,`0.0`),e.named(`gain`,`1.0`),e.named(`contrast`,`1.0`),e.named(`contrastpivot`,`0.5`),e.named(`exposure`,`0.0`)].join(`, `)})`;return nr(t)===4?`vec4f(${r}, ${n}.a)`:r},[Nn,qn]),I(`blackbody`,e=>`mx_blackbody(${e.named(`temperature`,`5000.0`)})`,Wn),I(`luminance`,(e,t)=>{let n=`mx_luminance(${e.named(`in`,void 0,0)})`;return nr(t)===1?`${n}.x`:nr(t)===4?`vec4f(${n}, 1.0)`:n},Mn),I(`rgbtohsv`,F(`mx_rgbtohsv`),Nn),I(`hsvtorgb`,F(`mx_hsvtorgb`),Nn),I(`position`,(e,t,n)=>n.varyings.position),I(`texcoord`,(e,t,n)=>n.varyings.texcoord),I(`normal`,(e,t,n)=>n.varyings.normal),I(`tangent`,(e,t,n)=>n.varyings.tangent),I(`bitangent`,(e,t,n)=>n.varyings.bitangent),I(`viewdirection`,(e,t,n)=>`normalize(-${n.varyings.viewDir})`),I(`geomcolor`,(e,t,n)=>`${n.wgslType(t)}(1.0)`),I(`time`,()=>`0.0`),I(`frame`,()=>`1.0`),I(`normalmap`,(e,t,n)=>`mx_normalmap(${e.named(`in`,void 0,0)}, vec2f(${e.named(`scale`,`1.0`,1)}), ${e.named(`normal`,n.varyings.normal)}, ${e.named(`tangent`,n.varyings.tangent)}, ${e.named(`bitangent`,n.varyings.bitangent)})`,In),I(`place2d`,(e,t,n)=>`mx_place2d(${[ir(e,n),e.named(`pivot`,`vec2f(0.0)`),e.named(`scale`,`vec2f(1.0)`),e.named(`rotate`,`0.0`),e.named(`offset`,`vec2f(0.0)`),`i32(${e.named(`operationorder`,`0`)})`].join(`, `)})`,Un),I(`ramplr`,(e,t,n)=>`mix(${e.named(`valuel`,tr(t,n))}, ${e.named(`valuer`,tr(t,n))}, clamp(${ir(e,n)}.x, 0.0, 1.0))`),I(`ramptb`,(e,t,n)=>`mix(${e.named(`valueb`,tr(t,n))}, ${e.named(`valuet`,tr(t,n))}, clamp(${ir(e,n)}.y, 0.0, 1.0))`),I(`ramp4`,(e,t,n)=>{let r=ir(e,n),i=tr(t,n),a=`clamp(${r}.x, 0.0, 1.0)`;return`mix(${`mix(${e.named(`valuebl`,i)}, ${e.named(`valuebr`,i)}, ${a})`}, ${`mix(${e.named(`valuetl`,i)}, ${e.named(`valuetr`,i)}, ${a})`}, clamp(${r}.y, 0.0, 1.0))`}),I(`splitlr`,(e,t,n)=>`mix(${e.named(`valuel`,tr(t,n))}, ${e.named(`valuer`,tr(t,n))}, step(${e.named(`center`,`0.5`)}, ${ir(e,n)}.x))`),I(`splittb`,(e,t,n)=>`mix(${e.named(`valueb`,tr(t,n))}, ${e.named(`valuet`,tr(t,n))}, step(${e.named(`center`,`0.5`)}, ${ir(e,n)}.y))`),I(`checkerboard`,(e,t,n)=>{let r=`dot(${`floor(${ir(e,n)} * ${e.named(`uvtiling`,`vec2f(8.0)`)} - ${e.named(`uvoffset`,`vec2f(0.0)`)})`}, vec2f(1.0))`;return`mix(${e.named(`color2`,`vec3f(0.0)`)}, ${e.named(`color1`,`vec3f(1.0)`)}, (${r} - 2.0 * floor(${r} / 2.0)))`}),I(`circle`,(e,t,n)=>{let r=`(${ir(e,n)} - ${e.named(`center`,`vec2f(0.0)`)})`,i=e.named(`radius`,`0.5`);return`select(1.0, 0.0, dot(${r}, ${r}) > ${i} * ${i})`}),I(`ramp_gradient`,e=>`mx_ramp_gradient(${[e.named(`x`,`0.0`),e.named(`interval1`,`0.0`),e.named(`interval2`,`1.0`),e.named(`color1`,`vec4f(0.0, 0.0, 0.0, 1.0)`),e.named(`color2`,`vec4f(1.0)`),`i32(${e.named(`interpolation`,`1`)})`,e.named(`prev_color`,`vec4f(0.0, 0.0, 0.0, 1.0)`),`i32(${e.named(`interval_num`,`1`)})`,`i32(${e.named(`num_intervals`,`2`)})`].join(`, `)})`,Kn),I(`ramp`,(e,t,n)=>{let r=`mx_ramp_x(${ir(e,n)}, i32(${e.named(`type`,`0`)}))`,i=`i32(${e.named(`interpolation`,`1`)})`,a=`i32(${e.named(`num_intervals`,`2`)})`,o=t=>e.named(`interval${t}`,t===1?`0.0`:`1.0`),s=t=>e.named(`color${t}`,t===1?`vec4f(0.0, 0.0, 0.0, 1.0)`:`vec4f(1.0)`),c=s(1);for(let e=1;e<=9;e++)c=`mx_ramp_gradient(${r}, ${o(e)}, ${o(e+1)}, ${s(e)}, ${s(e+1)}, ${i}, ${c}, ${e}, ${a})`;return c},Kn),I(`heighttonormal`,(e,t,n)=>{if(n.computeStage)throw Error(`heighttonormal requires graph-aware UV finite differences`);let r=e.named(`in`,`0.0`),i=ir(e,n);return`mx_heighttonormal(vec2f(dpdx(${r}), dpdy(${r})), vec2f(dpdx(${i}.x), dpdy(${i}.x)), vec2f(dpdx(${i}.y), dpdy(${i}.y)), ${e.named(`scale`,`1.0`)})`},Gn),I(`bump`,(e,t,n)=>{let r=e.named(`normal`,n.varyings.normal);if(n.computeStage)return r;let i=e.named(`height`,`0.0`),a=n.varyings.texcoord;return`mx_normalmap(${`mx_heighttonormal(vec2f(dpdx(${i}), dpdy(${i})), vec2f(dpdx(${a}.x), dpdy(${a}.x)), vec2f(dpdx(${a}.y), dpdy(${a}.y)), 1.0)`}, vec2f(${e.named(`scale`,`1.0`)}), ${r}, ${e.named(`tangent`,n.varyings.tangent)}, ${e.named(`bitangent`,n.varyings.bitangent)})`},[Gn,In]),I(`noise2d`,(e,t,n)=>{let r=`vec3f(${ir(e,n)}, 0.0)`;return`(${rr(t,e=>`mx_perlin3(${r}, ${e})`,`mx_perlin3v(${r})`)} * ${e.named(`amplitude`,`1.0`)} + ${e.named(`pivot`,`0.0`)})`},Rn),I(`noise3d`,(e,t,n)=>{let r=ar(e,n);return`(${rr(t,e=>`mx_perlin3(${r}, ${e})`,`mx_perlin3v(${r})`)} * ${e.named(`amplitude`,`1.0`)} + ${e.named(`pivot`,`0.0`)})`},Rn),I(`fractal2d`,(e,t,n)=>{let r=`vec3f(${ir(e,n)}, 0.0)`,i=`i32(${e.named(`octaves`,`3`)}), ${e.named(`lacunarity`,`2.0`)}, ${e.named(`diminish`,`0.5`)}`;return`(${rr(t,e=>`mx_fractal3(${r}, ${i}, ${e})`,`mx_fractal3v(${r}, ${i})`)} * ${e.named(`amplitude`,`1.0`)})`},Rn),I(`cellnoise2d`,(e,t,n)=>`${n.wgslType(t)}(mx_cellnoise3(vec3f(${ir(e,n)}, 0.0)))`,Rn),I(`cellnoise3d`,(e,t,n)=>`${n.wgslType(t)}(mx_cellnoise3(${ar(e,n)}))`,Rn),I(`worleynoise2d`,(e,t,n)=>{let r=`mx_worley(vec3f(${ir(e,n)}, 0.0), ${e.named(`jitter`,`1.0`)}, 2, i32(${e.named(`style`,`0`)}), ${nr(t)})`;return nr(t)===1?`${r}.x`:nr(t)===2?`${r}.xy`:r},[Bn,zn]),I(`worleynoise3d`,(e,t,n)=>{let r=`mx_worley(${ar(e,n)}, ${e.named(`jitter`,`1.0`)}, 3, i32(${e.named(`style`,`0`)}), ${nr(t)})`;return nr(t)===1?`${r}.x`:nr(t)===2?`${r}.xy`:r},[Bn,zn]),...[`unifiednoise2d`,`unifiednoise3d`].map(e=>I(e,(t,n,r)=>{let i=e===`unifiednoise2d`,a=`${i?ir(t,r):ar(t,r)} * ${t.named(`freq`,`1.0`)} + ${t.named(`offset`,`0.0`)}`,o=[i?`vec3f(${a}, 0.0)`:`(${a})`,i?`2`:`3`,t.named(`jitter`,`1.0`),`i32(${t.named(`octaves`,`3`)})`,t.named(`lacunarity`,`2.0`),t.named(`diminish`,`0.5`),`i32(${t.named(`type`,`0`)})`,`i32(${t.named(`style`,`0`)})`],s=t.named(`outmin`,`0.0`),c=t.named(`outmax`,`1.0`),l=`mix(${s}, ${c}, mx_unifiednoise(${o.join(`, `)}))`;return`select(${l}, clamp(${l}, min(${s}, ${c}), max(${s}, ${c})), ${t.named(`clampoutput`,`true`)})`},[Pn,Fn,Rn,Bn,zn,Vn])),I(`rotate2d`,e=>`mx_rotate2d(${e.named(`in`,void 0,0)}, ${e.named(`amount`,`0.0`,1)})`,Pn),I(`rotate3d`,e=>`mx_rotate3d(${e.named(`in`,void 0,0)}, ${e.named(`amount`,`0.0`,1)}, ${e.named(`axis`,`vec3f(0.0, 0.0, 1.0)`,2)})`,Fn),I(`fractal3d`,(e,t,n)=>{if(!e.has(`lacunarity`)&&!e.has(`diminish`)){let r=`f32(${e.named(`octaves`,`3.0`,1)})`;return nr(t)===1?`mx_fractal3d(${n.varyings.position}, ${e.named(`amplitude`,`1.0`,0)}, ${r})`:`(${n.wgslType(t)}(mx_fractal3d(${n.varyings.position}, 1.0, ${r})) * ${e.named(`amplitude`,`1.0`,0)})`}let r=ar(e,n),i=`i32(${e.named(`octaves`,`3`)}), ${e.named(`lacunarity`,`2.0`)}, ${e.named(`diminish`,`0.5`)}`;return`(${rr(t,e=>`mx_fractal3(${r}, ${i}, ${e})`,`mx_fractal3v(${r}, ${i})`)} * ${e.named(`amplitude`,`1.0`)})`},[Ln,Rn]),I(`artistic_ior`,e=>`mx_artistic_ior(${e.named(`reflectivity`,void 0,0)}, ${e.named(`edge_color`,`vec3f(0.0)`,1)})`,Jn),I(`artistic_ior_extinction`,e=>`mx_artistic_ior_extinction(${e.named(`reflectivity`,void 0,0)}, ${e.named(`edge_color`,`vec3f(0.0)`,1)})`,Jn),I(`roughness_anisotropy`,e=>`mx_roughness_anisotropy(${e.named(`roughness`,`0.0`,0)}, ${e.named(`anisotropy`,`0.0`,1)})`,Yn),I(`roughness_dual`,e=>`mx_roughness_dual(${e.named(`roughness`,`vec2f(0.0)`,0)})`,Xn),I(`open_pbr_anisotropy`,e=>{let t=`(1.0 - ${e.named(`anisotropy`,`0.0`)})`,n=e.named(`roughness`,`0.0`),r=`(${n} * ${n} * sqrt(2.0 / (1.0 + ${t} * ${t})))`;return`vec2f(${r}, ${t} * ${r})`}),I(`chiang_hair_absorption_from_color`,e=>`mx_chiang_hair_absorption_from_color(${e.named(`color`,void 0,0)})`,Zn),I(`chiang_hair_roughness`,e=>`mx_chiang_hair_roughness(${e.named(`longitudinal`,`0.0`,0)}, ${e.named(`azimuthal`,`0.0`,1)})`,Zn),I(`deon_hair_absorption_from_melanin`,e=>`mx_deon_hair_absorption_from_melanin(${e.named(`melanin_concentration`,`0.0`,0)}, ${e.named(`melanin_redness`,`0.0`,1)})`,Zn),cr(`oren_nayar_diffuse_bsdf`,(e,t,n)=>`mx_oren_nayar_diffuse_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`color`,`vec3f(0.18)`)}, ${e.named(`roughness`,`0.0`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`burley_diffuse_bsdf`,(e,t,n)=>`mx_burley_diffuse_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`color`,`vec3f(0.18)`)}, ${e.named(`roughness`,`0.0`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`translucent_bsdf`,(e,t,n)=>`mx_translucent_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`color`,`vec3f(1.0)`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`dielectric_bsdf`,(e,t,n)=>`mx_dielectric_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`tint`,`vec3f(1.0)`)}, ${e.named(`ior`,`1.5`)}, ${e.named(`roughness`,`0.0`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`conductor_bsdf`,(e,t,n)=>`mx_conductor_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`ior`,`vec3f(0.18)`)}, ${e.named(`extinction`,`vec3f(3.0)`)}, ${e.named(`roughness`,`0.0`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`generalized_schlick_bsdf`,(e,t,n)=>`mx_generalized_schlick_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`color0`,`vec3f(1.0)`)}, ${e.named(`color90`,`vec3f(1.0)`)}, ${e.named(`roughness`,`0.0`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`sheen_bsdf`,(e,t,n)=>`mx_sheen_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`color`,`vec3f(1.0)`)}, ${e.named(`roughness`,`0.3`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`subsurface_bsdf`,(e,t,n)=>`mx_subsurface_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`color`,`vec3f(1.0)`)}, ${e.named(`radius`,`vec3f(1.0)`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`,On),cr(`chiang_hair_bsdf`,e=>`mx_chiang_hair_bsdf(${e.named(`weight`,`1.0`)}, ${e.named(`tint`,`vec3f(1.0)`)}, ${e.named(`roughness`,`vec2f(0.1)`)})`),cr(`anisotropic_vdf`,(e,t,n)=>`mx_anisotropic_vdf(${e.named(`absorption`,`vec3f(0.0)`)}, ${e.named(`scattering`,`vec3f(0.0)`)}, ${e.named(`anisotropy`,`0.0`)}, ${n.varyings.viewDir})`,On),cr(`uniform_edf`,e=>`mx_uniform_edf(${e.named(`color`,`vec3f(0.0)`)})`),cr(`generalized_schlick_edf`,(e,t,n)=>`mx_generalized_schlick_edf(${e.named(`color`,`vec3f(0.0)`)}, ${e.named(`tint`,`vec3f(1.0)`)}, ${e.named(`normal`,n.varyings.normal)}, ${n.varyings.viewDir})`),cr(`surface`,e=>`mx_surface(${e.named(`bsdf`,`mx_closure_zero()`)}, ${e.named(`edf`,`mx_closure_zero()`)}, ${e.named(`opacity`,`1.0`)})`,kn)],ur=new Map(lr.map(e=>[e.category,e])),dr=new Set([`image`,`tiledimage`,`hextiledimage`,`layer`,`surfacematerial`,`displacement`]);function fr(e){return ur.get(e)}function pr(e){return ur.has(e)||dr.has(e)}function mr(){return[...ur.keys(),...dr]}function hr(e,t,n,r){let i=P(2),a=P(3),o=t=>e.constant(N,t),s=(t,n,r)=>e.add({kind:`call`,type:n,op:t,args:[],namedArgs:r}),c=(t,n)=>e.add({kind:`swizzle`,type:N,source:t,pattern:n}),l=(e,t)=>s(`combine2`,i,{in1:e,in2:t}),u=(e,t,n)=>s(`combine3`,a,{in1:e,in2:t,in3:n}),d=(e,t,n,r=N)=>s(e,r,{in1:t,in2:n}),f=(e,t,n)=>d(`add`,e,t,n),p=(e,t,n)=>d(`subtract`,e,t,n),m=(e,t,n)=>d(`multiply`,e,t,n),h=(e,t,n)=>d(`divide`,e,t,n),g=(e,t,n=N)=>s(e,n,{in:t}),_=(e,t,n,r=N)=>s(`mix`,r,{bg:e,fg:t,mix:n}),v=(t,n)=>e.add({kind:`convert`,type:n,source:t,from:N}),y=o(0),b=o(1),x=f(m(m(n.texcoord,n.tiling,i),e.constant(i,[1,-1]),i),e.constant(i,[0,1]),i),S=c(x,`x`),C=c(x,`y`),w=o(Math.sqrt(3)*2),T=l(m(p(S,m(o(.57735027),C)),w),m(m(C,o(1.15470054)),w)),E=g(`fract`,T,i),D=c(E,`x`),O=c(E,`y`),k=p(p(b,D),O),A=s(`ifgreatereq`,N,{value1:y,value2:k,in1:b,in2:y}),j=p(m(o(2),A),b),M=[m(p(y,k),j),p(A,m(O,j)),p(A,m(D,j))],ee=g(`floor`,T,i),te=p(b,A),ne=[l(A,A),l(A,te),l(te,A)].map(e=>f(ee,e,i)),re=[];for(let t of ne){let s=c(t,`x`),y=c(t,`y`),S=l(h(f(s,m(o(.5),y)),w),h(y,m(o(1.15470054),w))),C=f(t,e.constant(i,[.12345,.12345]),i),T=c(C,`x`),E=g(`fract`,m(u(T,c(C,`y`),T),e.constant(a,[.1031,.103,.0973]),a),a),D=f(E,v(d(`dotproduct`,E,f(e.add({kind:`swizzle`,type:a,source:E,pattern:`yzx`}),e.constant(a,[33.33,33.33,33.33]),a)),a),a),O=c(D,`x`),k=c(D,`y`),A=c(D,`z`),j=g(`fract`,l(m(f(O,k),A),m(f(O,A),k)),i),M=c(j,`x`),ee=c(j,`y`),te=m(_(c(n.rotationrange,`x`),c(n.rotationrange,`y`),m(M,n.rotation)),o(Math.PI/180)),ne=g(`sin`,te),ie=g(`cos`,te),ae=p(x,S,i),oe=c(ae,`x`),se=c(ae,`y`),ce=l(p(m(oe,ie),m(se,ne)),f(m(oe,ne),m(se,ie))),le=_(b,_(c(n.scalerange,`x`),c(n.scalerange,`y`),ee),n.scale),ue=c(n.offsetrange,`x`),de=c(n.offsetrange,`y`),fe=l(_(ue,de,m(M,n.offset)),_(ue,de,m(ee,n.offset)));re.push(r(f(f(h(ce,v(le,i),i),S,i),fe,i)))}let ie=e=>{let t=M.map((t,n)=>m(e[n],d(`power`,t,o(7)))),r=e=>f(f(e[0],e[1]),e[2]),i=r(t),a=t.map(e=>h(e,i)),c=s(`clamp`,N,{in:n.falloff,low:o(.001),high:o(.999)}),l=a.map(e=>{let t=m(p(h(b,c),o(2)),p(b,m(o(2),e)));return s(`ifgreater`,N,{value1:o(.5),value2:e,in1:h(e,f(t,b)),in2:h(p(t,e),p(t,b))})}),u=r(l);return l.map(e=>h(e,u))},ae=ie(re.map(r=>{let i=t.kind===`vector`&&t.size===4?e.add({kind:`swizzle`,type:a,source:r,pattern:`xyz`}):r;return _(b,d(`dotproduct`,i,n.lumacoeffs),n.falloffcontrast)})),oe=(e,t,n)=>{let r=e.map((e,r)=>m(e,v(t[r],n),n));return f(f(r[0],r[1],n),r[2],n)};if(t.kind===`vector`&&t.size===4){let n=oe(re.map(t=>e.add({kind:`swizzle`,type:a,source:t,pattern:`xyz`})),ae,a),r=ie([b,b,b]),i=re.map((e,t)=>m(c(e,`w`),r[t]));return s(`combine4`,t,{in1:c(n,`x`),in2:c(n,`y`),in3:c(n,`z`),in4:f(f(i[0],i[1]),i[2])})}return oe(re,ae,t)}var gr=new Set([`image`,`tiledimage`,`hextiledimage`]),_r=new Set([`gltf_image`,`gltf_colorimage`,`gltf_normalmap`,`gltf_iridescence_thickness`,`hextilednormalmap`]),vr=new Set([...mr(),...gr,..._r,`convert`,`geompropvalue`,`separate2`,`separate3`,`separate4`]);function yr(e){return e!==void 0&&(e.kind===`scalar`||e.kind===`vector`||e.kind===`matrix`)}function br(e,t){return e.kind===`scalar`&&t.kind===`scalar`?e.scalar===t.scalar:e.kind===`vector`&&t.kind===`vector`?e.size===t.size&&e.scalar===t.scalar:e.kind===`matrix`&&t.kind===`matrix`&&e.size===t.size}function xr(e){switch(e){case`float`:return N;case`integer`:return Pe;case`boolean`:return Fe;case`color3`:return Ie;case`vector3`:return P(3,`float`,`vector`)}}function Sr(e){return e.trim()===`true`?[1]:e.trim()===`false`?[0]:e.split(`,`).map(e=>{let t=Number.parseFloat(e.trim());return Number.isFinite(t)?t:0})}function Cr(e,t,n){if(t.kind===`vector`){let r=n[0]??0,i=[];for(let e=0;e<t.size;e++)i.push(n[e]??r);return e.constant(t,i)}if(t.kind===`scalar`)return e.constant(t,n[0]??0);if(t.kind===`matrix`){let r=t.size*t.size,i=[];for(let e=0;e<r;e++)i.push(n.length===r?n[e]:+(e%(t.size+1)===0));return e.constant(t,i)}return e.constant(N,n[0]??0)}function wr(e,t,n,r=Cn){let i=new Map,a=new Map,o,s=()=>n.constant(Ie,[0,0,0]),c=()=>{if(o===void 0){let e=P(2,`float`,`texcoord`);n.declarePrimvar({name:`st`,type:e}),o=n.add({kind:`primvar`,type:e,name:`st`})}return o},l=e=>{let t=a.get(e);if(t!==void 0)return t;let r=e.toLowerCase(),i=r.startsWith(`t`)?`tangent`:r.startsWith(`b`)?`bitangent`:`normal`,o=i===`normal`?`normal`:`vector`,s=n.add({kind:`input`,type:P(3,`float`,o),name:i});return a.set(e,s),s},u=e=>{switch(e.source.kind){case`value`:{let t=Ue(e.type)??N;return t.kind===`string`||t.kind===`filename`?void 0:Cr(n,t,Sr(e.source.value))}case`connection`:return v(e.source.nodeId,e.source.output);case`interface`:case`default`:return}},d=(e,t)=>{let r=n.get(e)?.type;return!yr(t)||!yr(r)||br(r,t)?e:n.add({kind:`convert`,type:t,source:e,from:r})},f=(e,t,r)=>n.add({kind:`call`,type:t,op:e,args:[],namedArgs:r}),p=(t,r,i)=>{let a=e.nodes.get(t),o=r??Ue(a.type)??Ie,s=a.inputs.find(e=>e.name===`file`),l=s?.source.kind===`value`?s.source.value:void 0;n.declareTexture({name:t,valueType:o,...s?.colorSpace===void 0?{}:{colorSpace:s.colorSpace},...l===void 0?{}:{fileRef:l}});let p=e=>{let t=a.inputs.find(t=>t.name===e);return t?.source.kind===`value`?t.source.value:a.nodeDef?.inputs?.find(t=>t.name===e)?.value},h=p(`uaddressmode`),g=p(`vaddressmode`),_=p(`filtertype`);n.declareSampler({name:t,...a.category===`tiledimage`?{addressU:`periodic`,addressV:`periodic`}:{...h===void 0?{}:{addressU:h},...g===void 0?{}:{addressV:g}},..._===void 0?{}:{filter:_}});let v=a.inputs.find(e=>e.name===`texcoord`),y=i??(v?u(v):void 0)??c();if(i===void 0&&a.category===`hextiledimage`){let e=P(2,`float`,`texcoord`),r=(e,r,i)=>{let o=m(t,e,r);if(o!==void 0)return o;let s=a.nodeDef?.inputs?.find(t=>t.name===e)?.value;return Cr(n,r,s===void 0?i:Sr(s))};return hr(n,o,{texcoord:d(y,e),tiling:r(`tiling`,e,[1,1]),rotation:r(`rotation`,N,[1]),rotationrange:r(`rotationrange`,e,[0,360]),scale:r(`scale`,N,[1]),scalerange:r(`scalerange`,e,[.5,2]),offset:r(`offset`,N,[1]),offsetrange:r(`offsetrange`,e,[0,1]),falloff:r(`falloff`,N,[.5]),falloffcontrast:r(`falloffcontrast`,N,[.5]),lumacoeffs:r(`lumacoeffs`,Ie,[.2722287,.6740818,.0536895])},e=>n.add({kind:`texture`,type:o,texture:t,uv:e,sampler:t}))}let b=P(2,`float`,`texcoord`);if(a.category===`tiledimage`){let e=(e,r)=>{let i=m(t,e,b);if(i!==void 0)return i;let o=a.nodeDef?.inputs?.find(t=>t.name===e)?.value;return Cr(n,b,o===void 0?r:Sr(o))};y=f(`multiply`,b,{in1:f(`divide`,b,{in1:f(`subtract`,b,{in1:f(`multiply`,b,{in1:d(y,b),in2:e(`uvtiling`,[1,1])}),in2:e(`uvoffset`,[0,0])}),in2:e(`realworldimagesize`,[1,1])}),in2:e(`realworldtilesize`,[1,1])})}if(a.category===`image`){let e=m(t,`uvtiling`,b),n=m(t,`uvoffset`,b),r=m(t,`uv_scale`,b),i=m(t,`uv_offset`,b);e!==void 0&&(y=f(`multiply`,b,{in1:d(y,b),in2:e})),n!==void 0&&(y=f(`subtract`,b,{in1:d(y,b),in2:n})),r!==void 0&&(y=f(`multiply`,b,{in1:d(y,b),in2:r})),i!==void 0&&(y=f(`add`,b,{in1:d(y,b),in2:i}))}(a.category===`image`||a.category===`tiledimage`)&&(y=f(`add`,b,{in1:f(`multiply`,b,{in1:d(y,b),in2:n.constant(b,[1,-1])}),in2:n.constant(b,[0,1])}));let x=n.add({kind:`texture`,type:o,texture:t,uv:d(y,b),sampler:t});for(let[e,r]of[[`x`,h],[`y`,g]]){if(r!==`constant`)continue;let i=n.add({kind:`swizzle`,type:N,source:y,pattern:e}),a=m(t,`default`,o)??Cr(n,o,[0]);x=f(`ifgreater`,o,{value1:i,value2:n.constant(N,1),in1:a,in2:x}),x=f(`ifgreater`,o,{value1:n.constant(N,0),value2:i,in1:a,in2:x})}return x},m=(t,n,r)=>{let i=e.nodes.get(t).inputs.find(e=>e.name===n),a=i?u(i):void 0;return a===void 0?void 0:d(a,r)},h=(t,r)=>{let i=e.nodes.get(t);switch(i.category){case`gltf_colorimage`:{let e=p(t,Le);for(let n of[`color`,`geomcolor`]){let r=m(t,n,Le);r!==void 0&&(e=f(`multiply`,Le,{in1:e,in2:r}))}return r===`outa`?n.add({kind:`swizzle`,type:N,source:e,pattern:`w`}):n.add({kind:`swizzle`,type:Ie,source:e,pattern:`xyz`})}case`gltf_normalmap`:{let e=P(3,`float`,`vector`);return f(`normalmap`,e,{in:p(t,e)})}case`hextilednormalmap`:{let e=P(2,`float`,`texcoord`),n=P(3,`float`,`vector`),r=m(t,`texcoord`,e)??c(),i=m(t,`tiling`,e),a=i===void 0?r:f(`multiply`,e,{in1:r,in2:i}),o={in:p(t,n,a)},s=m(t,`strength`,N);s!==void 0&&(o.scale=s);for(let e of[`normal`,`tangent`]){let r=m(t,e,n);r!==void 0&&(o[e]=r)}return f(`normalmap`,n,o)}case`gltf_iridescence_thickness`:{let e=p(t,P(3,`float`,`vector`)),r=n.add({kind:`swizzle`,type:N,source:e,pattern:`y`});return f(`mix`,N,{fg:m(t,`thicknessMin`,N)??n.constant(N,100),bg:m(t,`thicknessMax`,N)??n.constant(N,400),mix:r})}default:{let e=Ue(i.type)??Ie,n=p(t),r=m(t,`factor`,e);return r===void 0?n:f(`multiply`,e,{in1:n,in2:r})}}},g=t=>{let r=e.nodes.get(t),i=Ue(r.type)??Ie,a=r.inputs.find(e=>e.name===`in`),o=a?Ue(a.type)??N:N,s=(a?u(a):void 0)??n.constant(o,0),c=n.get(s)?.type??o;return n.add({kind:`convert`,type:i,source:s,from:c})},_=(t,r)=>{let i=e.nodes.get(t),a=Ue(i.type)??Ie,o=new Map;for(let e of i.nodeDef?.inputs??[])o.set(e.name,Ue(e.type));let s={};for(let e of i.inputs){let t=u(e);t!==void 0&&(s[e.name]=d(t,o.get(e.name)??Ue(e.type)))}for(let e of i.nodeDef?.inputs??[]){if(s[e.name]!==void 0||e.value===void 0)continue;let t=Ue(e.type);yr(t)&&(s[e.name]=Cr(n,t,Sr(e.value)))}let c=i.category===`artistic_ior`&&r===`extinction`?`artistic_ior_extinction`:i.category;return n.add(i.nodeDef===void 0?{kind:`call`,type:a,op:c,args:[],namedArgs:s}:{kind:`call`,type:a,op:c,args:[],namedArgs:s,nodeDef:i.nodeDef})};function v(t,a){let o=JSON.stringify([t,a]),l=i.get(o);if(l!==void 0)return l;let f=e.nodes.get(t);if(!f){r({level:`warning`,message:`Surface input references missing node '${t}'; substituting a neutral constant (REQ-013).`,detail:{nodeId:t}});let e=s();return i.set(o,e),e}let v;if(/^separate[234]$/.test(f.category)&&a&&/^out[xyzwrgba]$/.test(a)){let e=f.inputs.find(e=>e.name===`in`),t=Number(f.category.slice(-1)),r=(e?u(e):void 0)??s(),i=d(r,e?Ue(e.type)??P(t):P(t));v=n.add({kind:`swizzle`,type:N,source:i,pattern:a.slice(3)})}else if(f.category===`geompropvalue`){let e=f.inputs.find(e=>e.name===`geomprop`),i=e?.source.kind===`value`?e.source.value:void 0;if(f.type===`vector2`&&(i===`st`||i===`UV0`))v=c();else{r({level:`warning`,message:`Unsupported geometry property '${i??`<dynamic>`}' (${f.type}) on '${t}'; using its declared default.`,detail:{nodeId:t,property:i,type:f.type}});let e=Ue(f.type)??N;v=m(t,`default`,e)??Cr(n,e,Sr(f.nodeDef?.inputs?.find(e=>e.name==="default")?.value??`0`))}}else gr.has(f.category)?v=p(t):_r.has(f.category)?v=h(t,a):f.category===`convert`?v=g(t):fr(f.category)?v=_(t,a):(r({level:`warning`,message:`Upstream node '${f.category}' (${t}) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).`,detail:{nodeId:t,category:f.category}}),v=Cr(n,Ue(f.type)??Ie,[0]));return i.set(o,v),v}let y=new Map;for(let[e,r]of t.inputs){let t;switch(r.source.kind){case`value`:case`default`:if(r.parameter){let e=xr(r.type);n.declareParam({name:r.parameter,type:e,defaultValue:r.source.value.length===1?r.source.value[0]:[...r.source.value],editable:!0}),t=n.add({kind:`param`,type:e,name:r.parameter})}else t=Cr(n,xr(r.type),r.source.value);break;case`connection`:t=d(v(r.source.nodeId,r.source.output),xr(r.type));break;case`geomprop`:t=l(r.source.name)}y.set(e,t)}return{family:t.family,nodeId:t.nodeId,inputs:y}}var Tr={oren_nayar_diffuse:0,burley_diffuse:1,translucent:2,dielectric_reflection:3,conductor:4,generalized_schlick:5,sheen:6,subsurface:7,dielectric_transmission:8,chiang_hair:9},Er=1,Dr=2,Or=4,kr=8,Ar=16,jr=32,Mr=64,Nr=128,Pr=256,Fr=512,Ir=1024;function Lr(e,t){return e[t]??0}function Rr(e,t,n){let r=0;n.color90!==void 0&&(r|=Er),n.roughness!==void 0&&(r|=Dr),n.anisotropy!==void 0&&(r|=Or),n.rotation!==void 0&&(r|=kr),n.ior!==void 0&&(r|=Ar),n.extinction!==void 0&&(r|=jr),n.thinWalled===!0&&(r|=Mr),n.attenuationColor!==void 0&&n.attenuationDistance!==void 0&&(r|=Nr),n.subsurfaceRadius!==void 0&&(r|=Pr),n.dispersion!==void 0&&(r|=Fr),n.hairTintTRT!==void 0&&(r|=Ir),e[t]=Tr[n.kind],e[t+1]=n.weight,e[t+2]=r,e[t+3]=n.color[0],e[t+4]=n.color[1],e[t+5]=n.color[2];let i=n.color90??n.color;e[t+6]=i[0],e[t+7]=i[1],e[t+8]=i[2],e[t+9]=n.roughness??0,e[t+10]=n.anisotropy??0,e[t+11]=n.rotation??0,e[t+12]=n.ior??0;let a=n.extinction??[0,0,0];e[t+13]=a[0],e[t+14]=a[1],e[t+15]=a[2];let o=n.attenuationColor??[0,0,0];e[t+16]=o[0],e[t+17]=o[1],e[t+18]=o[2],e[t+19]=n.attenuationDistance??0;let s=n.subsurfaceRadius??[0,0,0];e[t+20]=s[0],e[t+21]=s[1],e[t+22]=s[2],e[t+23]=n.dispersion??0;let c=n.hairTintTRT??[1,1,1];e[t+24]=c[0],e[t+25]=c[1],e[t+26]=c[2]}function zr(e){let t=new Float32Array(245),n=Math.min(e.lobes.length,8);t[0]=n,t[1]=e.opacity,t[2]=e.coat===void 0?0:1,t[3]=e.sheen===void 0?0:1,t[4]=e.fuzz===void 0?0:1,t[5]=e.thinFilm===void 0?0:1,t[6]=e.emission===void 0?0:1;let r=e.emission??[0,0,0];if(t[7]=r[0],t[8]=r[1],t[9]=r[2],e.coat!==void 0){let n=e.coat;t[10]=n.weight,t[11]=n.color[0],t[12]=n.color[1],t[13]=n.color[2],t[14]=n.roughness,t[15]=n.ior}if(e.sheen!==void 0){let n=e.sheen;t[16]=n.weight,t[17]=n.color[0],t[18]=n.color[1],t[19]=n.color[2],t[20]=n.roughness}if(e.fuzz!==void 0){let n=e.fuzz;t[21]=n.weight,t[22]=n.color[0],t[23]=n.color[1],t[24]=n.color[2],t[25]=n.roughness}if(e.thinFilm!==void 0){let n=e.thinFilm;t[26]=n.weight,t[27]=n.thickness,t[28]=n.ior}for(let r=0;r<n;r++){let n=e.lobes[r];n!==void 0&&Rr(t,29+r*27,n)}return t}function Br(e,t=new Set){let n=0;for(let r=0;r*245<e.length;r++)t.has(r)||(n=Math.max(n,Math.min(Math.round(Lr(e,r*245)),8)));return n}function Vr(){return`const MX_MATERIAL_RECORD_FLOATS: u32 = 245u;
const MX_MATERIAL_HEADER_FLOATS: u32 = 29u;
const MX_LOBE_FLOATS: u32 = 27u;
const MX_LOBE_HAS_COLOR90: u32 = ${Er}u;
const MX_LOBE_HAS_ROUGHNESS: u32 = ${Dr}u;
const MX_LOBE_HAS_ANISOTROPY: u32 = ${Or}u;
const MX_LOBE_HAS_ROTATION: u32 = ${kr}u;
const MX_LOBE_HAS_IOR: u32 = ${Ar}u;
const MX_LOBE_HAS_EXTINCTION: u32 = ${jr}u;
const MX_LOBE_THIN_WALLED: u32 = ${Mr}u;
const MX_LOBE_HAS_ATTENUATION: u32 = ${Nr}u;
const MX_LOBE_HAS_SUBSURFACE_RADIUS: u32 = ${Pr}u;
fn mx_material_lobe(base : u32) -> MxBsdfLobe {
  var lobe : MxBsdfLobe;
  lobe.kind = u32(round(materials[base]));
  lobe.weight = materials[base + 1u];
  let flags = u32(round(materials[base + 2u]));
  lobe.color = vec3f(materials[base + 3u], materials[base + 4u], materials[base + 5u]);
  if ((flags & MX_LOBE_HAS_COLOR90) != 0u) {
    lobe.color90 = vec3f(materials[base + 6u], materials[base + 7u], materials[base + 8u]);
  } else {
    lobe.color90 = lobe.color;
  }
  lobe.roughness = select(0.0, materials[base + 9u], (flags & MX_LOBE_HAS_ROUGHNESS) != 0u);
  lobe.anisotropy = select(0.0, materials[base + 10u], (flags & MX_LOBE_HAS_ANISOTROPY) != 0u);
  lobe.rotation = select(0.0, materials[base + 11u], (flags & MX_LOBE_HAS_ROTATION) != 0u);
  lobe.ior = select(0.0, materials[base + 12u], (flags & MX_LOBE_HAS_IOR) != 0u);
  if ((flags & MX_LOBE_HAS_EXTINCTION) != 0u) {
    lobe.extinction = vec3f(materials[base + 13u], materials[base + 14u], materials[base + 15u]);
  } else {
    lobe.extinction = vec3f(0.0, 0.0, 0.0);
  }
  lobe.thin = select(0.0, 1.0, (flags & MX_LOBE_THIN_WALLED) != 0u);
  lobe.dispersion = materials[base + 23u];
  lobe.hairTintTRT = vec3f(materials[base + 24u], materials[base + 25u], materials[base + 26u]);
  return lobe;
}
fn mx_material_closure(matIndex : u32) -> LayeredClosure {
  var c : LayeredClosure;
  let base = matIndex * MX_MATERIAL_RECORD_FLOATS;
  let lobeCount = min(u32(round(materials[base])), MX_MAX_LOBES);
  c.lobeCount = lobeCount;
  c.opacity = materials[base + 1u];
  c.hasCoat = u32(round(materials[base + 2u]));
  c.hasSheen = u32(round(materials[base + 3u]));
  c.hasFuzz = u32(round(materials[base + 4u]));
  c.hasThinFilm = u32(round(materials[base + 5u]));
  c.hasEmission = u32(round(materials[base + 6u]));
  c.emission = vec3f(materials[base + 7u], materials[base + 8u], materials[base + 9u]);
  c.coat = MxCoatLayer(materials[base + 10u], vec3f(materials[base + 11u], materials[base + 12u], materials[base + 13u]), materials[base + 14u], materials[base + 15u]);
  c.sheen = MxSheenLayer(materials[base + 16u], vec3f(materials[base + 17u], materials[base + 18u], materials[base + 19u]), materials[base + 20u]);
  c.fuzz = MxFuzzLayer(materials[base + 21u], vec3f(materials[base + 22u], materials[base + 23u], materials[base + 24u]), materials[base + 25u]);
  c.thinFilm = MxThinFilmLayer(materials[base + 26u], materials[base + 27u], materials[base + 28u]);
  for (var i : u32 = 0u; i < MX_MAX_LOBES; i = i + 1u) {
    if (i < lobeCount) {
      c.lobes[i] = mx_material_lobe(base + MX_MATERIAL_HEADER_FLOATS + i * MX_LOBE_FLOATS);
    }
  }
  // Interior participating medium derivation: subsurface radius takes priority
  // over transmissive absorption, mirroring interiorMediumFor on the CPU oracle.
  var sssFound = false;
  for (var i : u32 = 0u; i < MX_MAX_LOBES; i = i + 1u) {
    if (i >= lobeCount) { break; }
    let lb = base + MX_MATERIAL_HEADER_FLOATS + i * MX_LOBE_FLOATS;
    let kind = u32(round(materials[lb]));
    let lflags = u32(round(materials[lb + 2u]));
    if (kind == MX_LOBE_SUBSURFACE && (lflags & MX_LOBE_HAS_SUBSURFACE_RADIUS) != 0u && !sssFound) {
      let scol = vec3f(materials[lb + 3u], materials[lb + 4u], materials[lb + 5u]);
      let radius = vec3f(materials[lb + 20u], materials[lb + 21u], materials[lb + 22u]);
      let g = select(0.0, materials[lb + 10u], (lflags & MX_LOBE_HAS_ANISOTROPY) != 0u);
      let m = mx_subsurface_medium(scol, radius, g);
      c.interiorSigmaA = m.sigmaA;
      c.interiorSigmaS = m.sigmaS;
      c.interiorG = m.g;
      c.hasInterior = 1u;
      sssFound = true;
    }
  }
  if (!sssFound) {
    for (var i : u32 = 0u; i < MX_MAX_LOBES; i = i + 1u) {
      if (i >= lobeCount) { break; }
      let lb = base + MX_MATERIAL_HEADER_FLOATS + i * MX_LOBE_FLOATS;
      let kind = u32(round(materials[lb]));
      let lflags = u32(round(materials[lb + 2u]));
      if (kind == MX_LOBE_DIELECTRIC_TRANSMISSION && (lflags & MX_LOBE_HAS_ATTENUATION) != 0u && c.hasInterior == 0u) {
        let acol = vec3f(materials[lb + 16u], materials[lb + 17u], materials[lb + 18u]);
        let adist = materials[lb + 19u];
        let m = mx_absorbing_medium(acol, adist);
        c.interiorSigmaA = m.sigmaA;
        c.interiorSigmaS = m.sigmaS;
        c.interiorG = m.g;
        c.hasInterior = 1u;
      }
    }
  }
  return c;
}`}function Hr(e){let t=e.filter(e=>e.type!==`dome`),i=new Float32Array(Math.max(1,t.length)*20),a=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]];return t.forEach((e,t)=>{if(![`rect`,`sphere`,`distant`].includes(e.type)||e.textureFile||e.iesFile||e.coneAngle!==void 0||e.colorTemperature!==void 0)throw Error(`Unsupported converted path-tracer light at ${e.path}: ${e.type} or light shaping.`);let o=t*20;if(![...e.transform,...e.color,e.intensity,e.exposure].every(Number.isFinite)||e.intensity<0||e.color.some(e=>e<0))throw Error(`Invalid analytic light values at ${e.path}`);let s=e.type===`rect`?0:e.type===`sphere`?1:2,c=n(e.transform,[0,0,0]),l=[0,0,0],u=[0,0,0],d=[0,0,0],f=0,p=0;if(s===0){if(!Number.isFinite(e.width??1)||!Number.isFinite(e.height??1)||(e.width??1)<=0||(e.height??1)<=0)throw Error(`Degenerate rectangular light at ${e.path}`);l=r(e.transform,[e.width??1,0,0]),u=r(e.transform,[0,e.height??1,0]);let t=a(l,u);if(p=Math.hypot(...t),!(p>0))throw Error(`Degenerate rectangular light at ${e.path}`);d=[-t[0]/p,-t[1]/p,-t[2]/p]}else if(s===1){let t=[[1,0,0],[0,1,0],[0,0,1]].map(t=>r(e.transform,t)),n=t.map(e=>Math.hypot(...e));if(Math.max(...n)-Math.min(...n)>1e-5)throw Error(`Non-uniform sphere light scale at ${e.path}`);for(let r=0;r<3;r++)for(let i=r+1;i<3;i++){let a=t[r],o=t[i];if(Math.abs(a[0]*o[0]+a[1]*o[1]+a[2]*o[2])>1e-5*n[r]*n[i])throw Error(`Sheared sphere light at ${e.path}`)}if(f=(e.radius??.5)*n[0],p=4*Math.PI*f*f,!(f>0)||!Number.isFinite(f))throw Error(`Degenerate sphere light at ${e.path}`)}else if(c=r(e.transform,[0,0,-1]),!(Math.hypot(...c)>0))throw Error(`Degenerate distant light at ${e.path}`);let m=e.intensity*2**e.exposure/(e.normalize&&p>0?p:1);if(i.set([...c,s],o),i.set([...e.color.map(e=>e*m),p],o+4),i.set([...l,f],o+8),i.set([...u,0],o+12),i.set([...d,0],o+16),!i.subarray(o,o+20).every(Number.isFinite))throw Error(`Analytic light exceeds GPU numeric range at ${e.path}`)}),i}var Ur=`
@group(0) @binding(9) var<storage, read> analyticLights: array<vec4f>;
struct MxLightSample { direction: vec3f, distance: f32, radiance: vec3f, pdf: f32, delta: bool };
struct MxLightHit { distance: f32, radiance: vec3f, pdf: f32, hit: bool };
fn mx_light_count() -> u32 { return u32(U.transport.z); }
fn mx_light_pdf(index: u32, origin: vec3f, point: vec3f, normal: vec3f) -> f32 {
  let b = index * 5u;
  let offset = point - origin;
  let distance2 = dot(offset, offset);
  let cosine = dot(normal, -normalize(offset));
  if (cosine <= 0.0 || distance2 <= 0.0) { return 0.0; }
  return distance2 / (analyticLights[b + 1u].w * cosine * f32(mx_light_count()));
}
fn mx_sample_light(origin: vec3f, u: vec3f) -> MxLightSample {
  var result: MxLightSample;
  let index = min(u32(u.z * f32(mx_light_count())), mx_light_count() - 1u);
  let b = index * 5u;
  let posType = analyticLights[b];
  result.radiance = analyticLights[b + 1u].xyz;
  if (posType.w == 2.0) {
    result.direction = -normalize(posType.xyz);
    result.distance = 1e30;
    result.pdf = 1.0 / f32(mx_light_count());
    result.delta = true;
    return result;
  }
  var point: vec3f;
  var normal = analyticLights[b + 4u].xyz;
  if (posType.w == 0.0) {
    point = posType.xyz + (u.x - 0.5) * analyticLights[b + 2u].xyz + (u.y - 0.5) * analyticLights[b + 3u].xyz;
  } else {
    let z = 1.0 - 2.0 * u.x;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let phi = 2.0 * PI * u.y;
    normal = vec3f(r * cos(phi), r * sin(phi), z);
    point = posType.xyz + normal * analyticLights[b + 2u].w;
  }
  result.distance = length(point - origin);
  result.direction = normalize(point - origin);
  result.pdf = mx_light_pdf(index, origin, point, normal);
  return result;
}
fn mx_intersect_lights(origin: vec3f, direction: vec3f) -> MxLightHit {
  var result: MxLightHit;
  result.distance = 1e30;
  for (var index = 0u; index < mx_light_count(); index++) {
    let b = index * 5u;
    let posType = analyticLights[b];
    if (posType.w == 2.0) { continue; }
    var normal = analyticLights[b + 4u].xyz;
    var distance = -1.0;
    if (posType.w == 0.0) {
      let cosine = dot(normal, direction);
      if (cosine >= -1e-8) { continue; }
      distance = dot(posType.xyz - origin, normal) / cosine;
      let offset = origin + direction * distance - posType.xyz;
      let u = analyticLights[b + 2u].xyz;
      let v = analyticLights[b + 3u].xyz;
      let uv = dot(u, v);
      let determinant = dot(u, u) * dot(v, v) - uv * uv;
      let a = (dot(offset, u) * dot(v, v) - dot(offset, v) * uv) / determinant;
      let c = (dot(offset, v) * dot(u, u) - dot(offset, u) * uv) / determinant;
      if (abs(a) > 0.5 || abs(c) > 0.5) { continue; }
    } else {
      let offset = origin - posType.xyz;
      let along = dot(offset, direction);
      let radius = analyticLights[b + 2u].w;
      let discriminant = along * along - dot(offset, offset) + radius * radius;
      if (discriminant < 0.0) { continue; }
      distance = -along - sqrt(discriminant);
      if (distance <= RAY_EPS) { continue; }
      normal = normalize(origin + direction * distance - posType.xyz);
    }
    if (distance <= RAY_EPS || distance >= result.distance) { continue; }
    result.distance = distance;
    result.radiance = analyticLights[b + 1u].xyz;
    result.pdf = mx_light_pdf(index, origin, origin + direction * distance, normal);
    result.hit = true;
  }
  return result;
}
`,Wr=245,Gr=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],Kr=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],qr=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2];function Jr(e){let t=Math.sqrt(qr(e,e));return t>0?[e[0]/t,e[1]/t,e[2]/t]:[e[0],e[1],e[2]]}function Yr(e){return e??`__neutral__`}function Xr(e,t={},i,a){let o=ue(e,t),s=new Map,c=[],u=[],d=[],f=[],p,m=(t,n,r)=>{let i=s.get(t);if(i!==void 0)return i;let a=c.length;s.set(t,a),c.push(n),u.push(t);let o=r===void 0?void 0:e.materials.get(r);o?.surfaceGraph&&o.resolvedSurface&&d.push({materialIndex:a,graph:o.surfaceGraph,surface:o.resolvedSurface});let l=o?.displacement;return f.push(l?l.scale:0),l&&p===void 0&&(p=l.file),a},h=[],g=[],_=[],v=[],y=0,b=!1;for(let i of o.draws){if(Zr(e,i.instanceId,t))continue;let o=e.geometries.get(i.prototypeId);if(!o)continue;let s=o.streams.find(e=>e.name===`position`);if(!s)continue;let c=o.streams.find(e=>e.name===`normal`),l=o.streams.find(e=>e.name===`uv`),u=o.streams.find(e=>e.name===`tangent`);u&&(b=!0);let d=m(Yr(i.materialKey),i.surface,i.materialKey),f=i.model,p=o.indices;for(let e=0;e+2<p.length;e+=3){let t=p[e],i=p[e+1],o=p[e+2],m=a?$r(a,y*3):n(f,$r(s.data,t)),x=a?$r(a,y*3+1):n(f,$r(s.data,i)),S=a?$r(a,y*3+2):n(f,$r(s.data,o)),C,w,T;if(c)C=Jr(r(f,$r(c.data,t))),w=Jr(r(f,$r(c.data,i))),T=Jr(r(f,$r(c.data,o)));else{let e=Jr(Kr(Gr(x,m),Gr(S,m)));C=e,w=e,T=e}a||h.push(m[0],m[1],m[2],x[0],x[1],x[2],S[0],S[1],S[2]);let E=y*24;g[E+0]=m[0],g[E+1]=m[1],g[E+2]=m[2],g[E+3]=x[0],g[E+4]=x[1],g[E+5]=x[2],g[E+6]=S[0],g[E+7]=S[1],g[E+8]=S[2],g[E+9]=C[0],g[E+10]=C[1],g[E+11]=C[2],g[E+12]=w[0],g[E+13]=w[1],g[E+14]=w[2],g[E+15]=T[0],g[E+16]=T[1],g[E+17]=T[2],g[E+18]=d;for(let e=19;e<24;e++)g[E+e]=0;let D=y*6;if(l){let e=ti(l.data,t),n=ti(l.data,i),r=ti(l.data,o);_[D]=e[0],_[D+1]=e[1],_[D+2]=n[0],_[D+3]=n[1],_[D+4]=r[0],_[D+5]=r[1]}else for(let e=0;e<6;e++)_[D+e]=0;let O=y*ii;if(u){let e=qr(Kr([f[0],f[1],f[2]],[f[4],f[5],f[6]]),[f[8],f[9],f[10]])<0?-1:1,n=Jr(r(f,ei(u.data,t,u.components))),a=Jr(r(f,ei(u.data,i,u.components))),s=Jr(r(f,ei(u.data,o,u.components)));v[O]=n[0],v[O+1]=n[1],v[O+2]=n[2],v[O+4]=a[0],v[O+5]=a[1],v[O+6]=a[2],v[O+8]=s[0],v[O+9]=s[1],v[O+10]=s[2];for(let[n,r]of[t,i,o].entries())v[O+n*4+3]=e*(u.components>=4?u.data[r*u.components+3]:1)}else if(b)for(let e=0;e<ii;e++)v[O+e]=0;y++}}let x=a??new Float32Array(h),S=new Uint32Array(y*3);for(let e=0;e<S.length;e++)S[e]=e;let C=i;if(!C){let e=performance.now();C=ft(x,S,{splitStrategy:`sah`}),performance.measure(`pathtracing:bvh-build`,{start:e,end:performance.now(),detail:{triangles:y,nodes:C.nodes.length}})}let w=t.displacementScale??1,T=new Float32Array(f.map(e=>e*w)),E=0;for(let e of T)E=Math.max(E,.5*Math.abs(e));let D=p!==void 0&&E>0,O=ni(C,D?E:0),k=ri(c);return{nodes:O,nodeCount:C.nodes.length,triangles:new Float32Array(g),triangleOrder:C.triangleOrder,triangleCount:y,materials:k,materialCount:c.length,triangleUv:new Float32Array(_),triangleTangent:b?new Float32Array(v):new Float32Array,materialKeys:u,variantSources:d,camera:{viewProj:o.camera.viewProj,invViewProj:l(o.camera.viewProj),eye:o.camera.eye,exposure:o.camera.exposure},light:o.light,environment:o.environment,bounds:C.bounds,...t.settings?{settings:t.settings}:{},...t.settings?.converted?{analyticLights:Hr(t.lights??[]),analyticLightCount:t.lights?.filter(e=>e.type!==`dome`).length??0}:{},...D?{displacement:{mapFile:p,midpoint:.5,scale:T}}:{}}}function Zr(e,t,n){if(!n.settings?.converted)return!1;let r=e.instances.find(e=>e.id===t)?.primPath;return n.lights?.some(e=>r===`${e.path}_Geometry`)??!1}async function Qr(e,t={},r){let i=performance.now(),a=r;if(!a&&globalThis.indexedDB)try{a=await wt()}catch(e){console.warn(`Path-tracing BVH cache unavailable; building the BVH without persistent caching.`,e)}if(!a)return Xr(e,t);let o=ue(e,t),s=[];for(let r of o.draws){if(Zr(e,r.instanceId,t))continue;let i=e.geometries.get(r.prototypeId),a=i?.streams.find(e=>e.name===`position`);if(i&&a)for(let e of i.indices){let t=n(r.model,$r(a.data,e));s.push(t[0],t[1],t[2])}}let c=new Float32Array(s),l=await Dt(c);if(!l)return console.warn(`Web Crypto unavailable; path-tracing BVH will not be cached.`),Xr(e,t);let u;try{u=await a.get(l)}catch(e){console.warn(`Failed to read the path-tracing BVH cache; rebuilding the BVH.`,e)}let d=u!==void 0;if(!u){let e=new Uint32Array(c.length/3);for(let t=0;t<e.length;t++)e[t]=t;let t=performance.now();u=ft(c,e,{splitStrategy:`sah`}),performance.measure(`pathtracing:bvh-build`,{start:t,end:performance.now(),detail:{triangles:e.length/3,nodes:u.nodes.length}});try{await a.set(l,u)}catch(e){console.warn(`Failed to persist the path-tracing BVH.`,e)}}return performance.measure(`pathtracing:bvh-cache`,{start:i,end:performance.now(),detail:{hit:d,triangles:c.length/9}}),Xr(e,t,u,c)}function $r(e,t){let n=t*3;return[e[n],e[n+1],e[n+2]]}function ei(e,t,n){let r=t*n;return[e[r],e[r+1],e[r+2]]}function ti(e,t){let n=t*2;return[e[n],e[n+1]]}function ni(e,t=0){let n=new Float32Array(e.nodes.length*12);for(let r=0;r<e.nodes.length;r++){let i=e.nodes[r],a=r*12;n[a+0]=i.min[0]-t,n[a+1]=i.min[1]-t,n[a+2]=i.min[2]-t,n[a+3]=i.left,n[a+4]=i.max[0]+t,n[a+5]=i.max[1]+t,n[a+6]=i.max[2]+t,n[a+7]=i.right,n[a+8]=i.start,n[a+9]=i.count,n[a+10]=0,n[a+11]=0}return n}function ri(e){let t=new Float32Array(Math.max(e.length,1)*Wr);for(let n=0;n<e.length;n++)t.set(zr(qe(e[n])),n*Wr);return t}var ii=12,ai=`
struct Hit { t : f32, tri : u32, u : f32, v : f32, hitAny : bool };

fn tri_vertex(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * TRI_STRIDE + slot * 3u;
  return vec3<f32>(tris[b], tris[b + 1u], tris[b + 2u]);
}

fn tri_normal(tri : u32, slot : u32) -> vec3<f32> {
  let b = tri * TRI_STRIDE + 9u + slot * 3u;
  return vec3<f32>(tris[b], tris[b + 1u], tris[b + 2u]);
}

fn tri_material(tri : u32) -> u32 {
  return u32(tris[tri * TRI_STRIDE + 18u]);
}

fn intersect_tri(tri : u32, ro : vec3<f32>, rd : vec3<f32>, tMax : f32) -> vec4<f32> {
  let v0 = tri_vertex(tri, 0u);
  let v1 = tri_vertex(tri, 1u);
  let v2 = tri_vertex(tri, 2u);
  let e1 = v1 - v0;
  let e2 = v2 - v0;
  let p = cross(rd, e2);
  let det = dot(e1, p);
  if (abs(det) < 1.0e-9) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let inv = 1.0 / det;
  let tvec = ro - v0;
  let u = dot(tvec, p) * inv;
  if (u < 0.0 || u > 1.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let q = cross(tvec, e1);
  let vv = dot(rd, q) * inv;
  if (vv < 0.0 || u + vv > 1.0) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  let t = dot(e2, q) * inv;
  if (t <= RAY_EPS || t >= tMax) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  return vec4<f32>(t, u, vv, 1.0);
}

fn aabb_hit(node : u32, ro : vec3<f32>, invDir : vec3<f32>, tMax : f32) -> f32 {
  let b = node * NODE_STRIDE;
  var tmin = RAY_EPS;
  var tmax = tMax;
  for (var a = 0u; a < 3u; a = a + 1u) {
    let lo = (nodes[b + a] - ro[a]) * invDir[a];
    let hi = (nodes[b + 4u + a] - ro[a]) * invDir[a];
    tmin = max(tmin, min(lo, hi));
    tmax = min(tmax, max(lo, hi));
    if (tmax < tmin) { return -1.0; }
  }
  return tmin;
}

fn traverse(ro : vec3<f32>, rd : vec3<f32>, tMax : f32, anyHit : bool) -> Hit {
  var result : Hit;
  result.t = tMax;
  result.hitAny = false;
  let invDir = vec3<f32>(1.0 / select(rd.x, 1.0e-20, rd.x == 0.0),
                         1.0 / select(rd.y, 1.0e-20, rd.y == 0.0),
                         1.0 / select(rd.z, 1.0e-20, rd.z == 0.0));
  var stack : array<u32, 64>;
  var sp = 0;
  var node = 0u;
  var closest = tMax;
  if (arrayLength(&nodes) < NODE_STRIDE || aabb_hit(node, ro, invDir, closest) < 0.0) { return result; }
  loop {
    let b = node * NODE_STRIDE;
    let count = u32(nodes[b + 9u]);
    if (count > 0u) {
      let start = u32(nodes[b + 8u]);
      for (var i = 0u; i < count; i = i + 1u) {
        let tri = triOrder[start + i];
        let h = intersect_tri(tri, ro, rd, closest);
        if (h.w > 0.5) {
          if (anyHit) {
            result.hitAny = true;
            result.t = h.x;
            result.tri = tri;
            return result;
          }
          closest = h.x;
          result.t = h.x;
          result.tri = tri;
          result.u = h.y;
          result.v = h.z;
          result.hitAny = true;
        }
      }
    } else {
      let left = u32(nodes[b + 3u]);
      let right = u32(nodes[b + 7u]);
      let leftT = aabb_hit(left, ro, invDir, closest);
      let rightT = aabb_hit(right, ro, invDir, closest);
      if (leftT >= 0.0 || rightT >= 0.0) {
        if (leftT >= 0.0 && rightT >= 0.0) {
          let leftFirst = leftT <= rightT;
          stack[sp] = select(left, right, leftFirst);
          sp = sp + 1;
          node = select(right, left, leftFirst);
        } else {
          node = select(right, left, leftT >= 0.0);
        }
        continue;
      }
    }
    var found = false;
    loop {
      if (sp <= 0) { break; }
      sp = sp - 1;
      node = stack[sp];
      if (aabb_hit(node, ro, invDir, closest) >= 0.0) { found = true; break; }
    }
    if (!found) { break; }
  }
  return result;
}
`,oi={kinds:new Set([0,1,2,3,4,5,6,7,8,9]),thinFilm:!0};function si(e){let t=(...t)=>t.filter(t=>e.kinds.has(t)),n=e=>e.map(e=>`${e}u`).join(`, `),r=[],i=[],a=t(0,1);a.length&&(r.push(`    case ${n(a)}: { return mx_diffuse_eval(ctx, wi); }`),i.push(`    case ${n(a)}: { return mx_diffuse_sample(ctx, u.xy); }`)),t(2).length&&(r.push(`    case 2u: { return mx_translucent_eval(ctx, wi); }`),i.push(`    case 2u: { return mx_translucent_sample(ctx, u.xy); }`)),t(3).length&&(r.push(e.thinFilm?`    case 3u: {
      let f0 = vec3f(mx_dielectric_f0(lobe.ior));
      if (filmActive) {
        if (lobe.anisotropy <= 0.0) { return mx_microfacet_eval_tf(wo, wi, mx_alpha_of(lobe.roughness), f0, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior); }
        return mx_microfacet_eval_aniso_tf(wo, wi, mx_aniso_alphas(lobe.roughness, lobe.anisotropy), lobe.rotation, f0, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior);
      }
      return mx_dielectric_reflection_eval(ctx, wi);
    }`:`    case 3u: { return mx_dielectric_reflection_eval(ctx, wi); }`),i.push(`    case 3u: { return mx_dielectric_reflection_sample(ctx, u.xy); }`));let o=t(4,5);return o.length&&(r.push(e.thinFilm?`    case ${n(o)}: {
      if (filmActive) {
        if (lobe.anisotropy <= 0.0) { return mx_microfacet_eval_tf(wo, wi, mx_alpha_of(lobe.roughness), lobe.color, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior); }
        return mx_microfacet_eval_aniso_tf(wo, wi, mx_aniso_alphas(lobe.roughness, lobe.anisotropy), lobe.rotation, lobe.color, c.thinFilm.weight, c.thinFilm.thickness, c.thinFilm.ior);
      }
      return mx_conductor_eval(ctx, wi);
    }`:`    case ${n(o)}: { return mx_conductor_eval(ctx, wi); }`),i.push(`    case ${n(o)}: { return mx_conductor_sample(ctx, u.xy); }`)),t(6).length&&(r.push(`    case 6u: { return mx_sheen_eval(ctx, wi); }`),i.push(`    case 6u: { return mx_sheen_sample(ctx, u.xy); }`)),t(7).length&&(r.push(`    case 7u: { return mx_subsurface_eval(ctx, wi); }`),i.push(`    case 7u: { return mx_subsurface_sample(ctx, u.xy); }`)),t(8).length&&(r.push(`    case 8u: { return mx_dielectric_transmission_eval(ctx, wi); }`),i.push(`    case 8u: { return mx_dielectric_transmission_sample(ctx, u); }`)),t(9).length&&(r.push(`    case 9u: { return mx_hair_eval(lobe, wo, wi); }`),i.push(`    case 9u: { return mx_hair_sample(lobe, wo, u); }`)),`fn mx_closure_lobe_eval(lobe: MxBsdfLobe, c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let ctx = mx_closure_lobe_ctx(lobe, wo);${e.thinFilm?`
  let filmActive = c.hasThinFilm != 0u && c.thinFilm.weight > 0.0 && c.thinFilm.thickness > 0.0;`:``}
  switch (lobe.kind) {
${[...r,`    default: { return MxBsdfEval(vec3f(0.0), 0.0); }`].join(`
`)}
  }
}
fn mx_closure_lobe_sample(lobe: MxBsdfLobe, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let ctx = mx_closure_lobe_ctx(lobe, wo);
  switch (lobe.kind) {
${[...i,`    default: { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }`].join(`
`)}
  }
}`}function ci(e=oi){if(e===oi)return di;let t=di.replace(si(oi),si(e));return e.fuzz===!1&&(t=t.replace(li,`fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  return mx_closure_eval_base(c, wo, wi);
}`).replace(ui,`fn mx_closure_sample(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  return mx_closure_sample_base(c, wo, u);
}`)),e.kinds.has(9)?t:t.replace(b,``)}var li=`fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let base = mx_closure_eval_base(c, wo, wi);
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0) { return base; }
  let fuzzW = clamp(c.fuzz.weight, 0.0, 1.0);
  let fuzzCtx = MxLobeCtx(wo, c.fuzz.color, c.fuzz.roughness, 1.5, 0.0, 0.0, 0.0);
  let fuzz = mx_fuzz_eval(fuzzCtx, wi);
  let coverage = mx_closure_fuzz_coverage(c, wo);
  return MxBsdfEval(fuzz.value * fuzzW + base.value * (1.0 - coverage), fuzz.pdf * coverage + base.pdf * (1.0 - coverage));
}`,ui=`fn mx_closure_sample(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0) { return mx_closure_sample_base(c, wo, u); }
  if (wo.z == 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let coverage = mx_closure_fuzz_coverage(c, wo);
  var wi: vec3f;
  if (u.z < coverage) {
    let fuzzCtx = MxLobeCtx(wo, c.fuzz.color, c.fuzz.roughness, 1.5, 0.0, 0.0, 0.0);
    let s = mx_fuzz_sample(fuzzCtx, u.xy);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  } else {
    var baseU = u;
    baseU.z = (u.z - coverage) / max(1.0 - coverage, 1.0e-6);
    let s = mx_closure_sample_base(c, wo, baseU);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  }
  let e = mx_closure_eval(c, wo, wi);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}`,di=`const MX_PI: f32 = 3.14159265358979;

struct MxBsdfEval {
  value: vec3f,
  pdf: f32,
};
struct MxBsdfSample {
  wi: vec3f,
  value: vec3f,
  pdf: f32,
  valid: bool,
};
// Per-lobe context in the local shading frame (+Z = normal). color carries the
// albedo (diffuse/translucent) or the microfacet F0 tint (conductor); ior drives
// the achromatic dielectric F0; roughness is the perceptual value squared into
// the GGX alpha by mx_alpha_of. anisotropy in [0,1] splits the GGX alpha into
// alpha_u/alpha_v (0 = isotropic) and rotation (turns) spins the tangent frame.
struct MxLobeCtx {
  wo: vec3f,
  color: vec3f,
  roughness: f32,
  ior: f32,
  anisotropy: f32,
  rotation: f32,
  thin: f32,
};

fn mx_ggx_ndf(cosH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = cosH * cosH * (a2 - 1.0) + 1.0;
  return a2 / max(MX_PI * d * d, 1.0e-7);
}
fn mx_smith_g1(cosX: f32, a: f32) -> f32 {
  let a2 = a * a;
  return (2.0 * cosX) / max(cosX + sqrt(a2 + (1.0 - a2) * cosX * cosX), 1.0e-7);
}
fn mx_fresnel_schlick(f0: vec3f, cosT: f32) -> vec3f {
  let f = pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  return f0 + (vec3f(1.0) - f0) * f;
}
fn mx_alpha_of(roughness: f32) -> f32 {
  return max(roughness * roughness, 1.0e-3);
}
fn mx_dielectric_f0(ior: f32) -> f32 {
  let r = (ior - 1.0) / (ior + 1.0);
  return r * r;
}
fn mx_cosine_hemisphere(u: vec2f) -> vec3f {
  let r = sqrt(u.x);
  let phi = 2.0 * MX_PI * u.y;
  return vec3f(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u.x)));
}
fn mx_sample_ggx_normal(a: f32, u: vec2f) -> vec3f {
  let phi = 2.0 * MX_PI * u.x;
  let cosT = sqrt((1.0 - u.y) / (1.0 + (a * a - 1.0) * u.y));
  let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  return vec3f(sinT * cos(phi), sinT * sin(phi), cosT);
}
// Charlie sheen distribution (Estevez/Kulla), paired with the Ashikhmin visibility below.
fn mx_sheen_ndf(cosH: f32, roughness: f32) -> f32 {
  let inv = 1.0 / max(roughness, 1.0e-3);
  let sin2 = max(1.0 - cosH * cosH, 0.0);
  return (2.0 + inv) * pow(sin2, inv * 0.5) / (2.0 * MX_PI);
}

// --- diffuse (Lambert cosine): shared by oren_nayar/burley until T056 detail ---
fn mx_diffuse_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  return MxBsdfEval(ctx.color / MX_PI, wi.z / MX_PI);
}
fn mx_diffuse_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  return wi.z / MX_PI;
}
fn mx_diffuse_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_cosine_hemisphere(u);
  return MxBsdfSample(wi, ctx.color / MX_PI, wi.z / MX_PI, true);
}

// --- translucent (diffuse transmission): cosine lobe in the far hemisphere -----
fn mx_translucent_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z >= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  return MxBsdfEval(ctx.color / MX_PI, -wi.z / MX_PI);
}
fn mx_translucent_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z >= 0.0) { return 0.0; }
  return -wi.z / MX_PI;
}
fn mx_translucent_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let h = mx_cosine_hemisphere(u);
  let wi = vec3f(h.x, h.y, -h.z);
  return MxBsdfSample(wi, ctx.color / MX_PI, -wi.z / MX_PI, true);
}

// --- subsurface (BSSRDF optically-thick limit): cosine-diffuse response T056g --
fn mx_subsurface_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  return MxBsdfEval(ctx.color / MX_PI, wi.z / MX_PI);
}
fn mx_subsurface_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  return wi.z / MX_PI;
}
fn mx_subsurface_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_cosine_hemisphere(u);
  return MxBsdfSample(wi, ctx.color / MX_PI, wi.z / MX_PI, true);
}

// --- microfacet core (GGX NDF + separable Smith + Schlick Fresnel) -------------
fn mx_microfacet_eval(wo: vec3f, wi: vec3f, a: f32, f0: vec3f) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm0 = wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wo, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf(wm.z, a);
  let g = mx_smith_g1(wo.z, a) * mx_smith_g1(wi.z, a);
  let f = mx_fresnel_schlick(f0, cosVH);
  let value = f * (d * g / (4.0 * wo.z * wi.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}
fn mx_microfacet_pdf(wo: vec3f, wi: vec3f, a: f32) -> f32 {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  let wm0 = wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return 0.0; }
  let wm = normalize(wm0);
  let cosVH = dot(wo, wm);
  if (cosVH <= 0.0) { return 0.0; }
  return mx_ggx_ndf(wm.z, a) * wm.z / (4.0 * cosVH);
}
fn mx_microfacet_sample(wo: vec3f, a: f32, f0: vec3f, u: vec2f) -> MxBsdfSample {
  if (wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wm = mx_sample_ggx_normal(a, u);
  let wi = reflect(-wo, wm);
  if (wi.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let e = mx_microfacet_eval(wo, wi, a, f0);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}

// --- anisotropic microfacet core (GGX alpha_u/alpha_v + tangent rotation) ------
// alpha.x = alpha_u, alpha.y = alpha_v. With anisotropy 0 the aspect is 1 so
// alpha_u = alpha_v = mx_alpha_of(roughness) and every formula below collapses
// to the isotropic core above (same NDF, Smith term and sampled normal).
fn mx_aniso_alphas(roughness: f32, anisotropy: f32) -> vec2f {
  let base = mx_alpha_of(roughness);
  let aspect = sqrt(1.0 - min(max(anisotropy, 0.0), 0.98));
  return vec2f(min(base / aspect, 1.0), base * aspect);
}
fn mx_rotate_tangent(w: vec3f, rotation: f32) -> vec3f {
  if (rotation == 0.0) { return w; }
  let ang = 2.0 * MX_PI * rotation;
  let c = cos(ang);
  let s = sin(ang);
  return vec3f(w.x * c + w.y * s, -w.x * s + w.y * c, w.z);
}
fn mx_ggx_ndf_aniso(wm: vec3f, alpha: vec2f) -> f32 {
  let t = (wm.x * wm.x) / (alpha.x * alpha.x) + (wm.y * wm.y) / (alpha.y * alpha.y) + wm.z * wm.z;
  return 1.0 / max(MX_PI * alpha.x * alpha.y * t * t, 1.0e-7);
}
fn mx_smith_g1_aniso(w: vec3f, alpha: vec2f) -> f32 {
  let lam = sqrt(alpha.x * alpha.x * w.x * w.x + alpha.y * alpha.y * w.y * w.y + w.z * w.z);
  return (2.0 * w.z) / max(w.z + lam, 1.0e-7);
}
fn mx_sample_ggx_normal_aniso(alpha: vec2f, u: vec2f) -> vec3f {
  let phi = atan2(alpha.y * sin(2.0 * MX_PI * u.x), alpha.x * cos(2.0 * MX_PI * u.x));
  let cosP = cos(phi);
  let sinP = sin(phi);
  let a2 = 1.0 / ((cosP * cosP) / (alpha.x * alpha.x) + (sinP * sinP) / (alpha.y * alpha.y));
  let tan2 = a2 * u.y / max(1.0 - u.y, 1.0e-7);
  let cosT = 1.0 / sqrt(1.0 + tan2);
  let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
  return vec3f(sinT * cosP, sinT * sinP, cosT);
}
fn mx_microfacet_eval_aniso(wo: vec3f, wi: vec3f, alpha: vec2f, rotation: f32, f0: vec3f) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wor = mx_rotate_tangent(wo, rotation);
  let wir = mx_rotate_tangent(wi, rotation);
  let wm0 = wor + wir;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wor, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf_aniso(wm, alpha);
  let g = mx_smith_g1_aniso(wor, alpha) * mx_smith_g1_aniso(wir, alpha);
  let f = mx_fresnel_schlick(f0, cosVH);
  let value = f * (d * g / (4.0 * wor.z * wir.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}
fn mx_microfacet_pdf_aniso(wo: vec3f, wi: vec3f, alpha: vec2f, rotation: f32) -> f32 {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  let wor = mx_rotate_tangent(wo, rotation);
  let wir = mx_rotate_tangent(wi, rotation);
  let wm0 = wor + wir;
  if (dot(wm0, wm0) <= 0.0) { return 0.0; }
  let wm = normalize(wm0);
  let cosVH = dot(wor, wm);
  if (cosVH <= 0.0) { return 0.0; }
  return mx_ggx_ndf_aniso(wm, alpha) * wm.z / (4.0 * cosVH);
}
fn mx_microfacet_sample_aniso(wo: vec3f, alpha: vec2f, rotation: f32, f0: vec3f, u: vec2f) -> MxBsdfSample {
  if (wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wor = mx_rotate_tangent(wo, rotation);
  let wm = mx_sample_ggx_normal_aniso(alpha, u);
  let wir = reflect(-wor, wm);
  if (wir.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_rotate_tangent(wir, -rotation);
  let e = mx_microfacet_eval_aniso(wo, wi, alpha, rotation, f0);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}

// --- dielectric_reflection (achromatic GGX from the index of refraction) -------
fn mx_dielectric_reflection_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  let f0 = vec3f(mx_dielectric_f0(ctx.ior));
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_eval(ctx.wo, wi, mx_alpha_of(ctx.roughness), f0);
  }
  return mx_microfacet_eval_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, f0);
}
fn mx_dielectric_reflection_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_pdf(ctx.wo, wi, mx_alpha_of(ctx.roughness));
  }
  return mx_microfacet_pdf_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation);
}
fn mx_dielectric_reflection_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  let f0 = vec3f(mx_dielectric_f0(ctx.ior));
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_sample(ctx.wo, mx_alpha_of(ctx.roughness), f0, u);
  }
  return mx_microfacet_sample_aniso(ctx.wo, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, f0, u);
}

// --- conductor (coloured GGX; color is the F0 tint) ----------------------------
fn mx_conductor_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_eval(ctx.wo, wi, mx_alpha_of(ctx.roughness), ctx.color);
  }
  return mx_microfacet_eval_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, ctx.color);
}
fn mx_conductor_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_pdf(ctx.wo, wi, mx_alpha_of(ctx.roughness));
  }
  return mx_microfacet_pdf_aniso(ctx.wo, wi, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation);
}
fn mx_conductor_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.anisotropy <= 0.0) {
    return mx_microfacet_sample(ctx.wo, mx_alpha_of(ctx.roughness), ctx.color, u);
  }
  return mx_microfacet_sample_aniso(ctx.wo, mx_aniso_alphas(ctx.roughness, ctx.anisotropy), ctx.rotation, ctx.color, u);
}

// --- sheen (Charlie NDF + Ashikhmin visibility; cosine-sampled layer lobe) ------
fn mx_sheen_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm0 = ctx.wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let d = mx_sheen_ndf(wm.z, ctx.roughness);
  let vis = 1.0 / (4.0 * (wi.z + ctx.wo.z - wi.z * ctx.wo.z));
  return MxBsdfEval(ctx.color * (d * vis), wi.z / MX_PI);
}
fn mx_sheen_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return 0.0; }
  return wi.z / MX_PI;
}
fn mx_sheen_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let wi = mx_cosine_hemisphere(u);
  let e = mx_sheen_eval(ctx, wi);
  return MxBsdfSample(wi, e.value, e.pdf, true);
}

// OpenPBR fuzz uses the Zeltner LTC model, not the Charlie sheen above.
fn mx_fuzz_dir_albedo(cosView: f32, roughness: f32) -> f32 {
  let r = clamp(roughness, 0.01, 1.0);
  let sigma = r * (0.0206607 + 1.58491 * r) / (0.0379424 + r * (1.32227 + r));
  let mean = r * (-0.193854 + r * (-1.14885 + r * (1.7932 - 0.95943 * r * r))) / (0.046391 + r);
  let offset = r * (0.000654023 + r * (-0.0207818 + 0.119681 * r)) / (1.26264 + r * (-1.92021 + r));
  let z = (clamp(cosView, 0.0, 1.0) - mean) / sigma;
  return clamp(exp(-0.5 * z * z) / (sigma * sqrt(2.0 * MX_PI)) + offset, 0.0, 1.0);
}
fn mx_fuzz_ltc(cosView: f32, roughness: f32) -> vec2f {
  let v = clamp(cosView, 0.0, 1.0);
  let r = clamp(roughness, 0.01, 1.0);
  let a = r * (2.58126 * v + 0.813703 * r) / (1.0 + 0.310327 * v * v + 2.60994 * v * r);
  let b = sqrt(1.0 - v) * (r - 1.0) * r * r * r / (0.0000254053 + 1.71228 * v - 1.71506 * v * r + 1.34174 * r * r);
  return vec2f(a, b);
}
fn mx_fuzz_tangent(wo: vec3f) -> vec3f {
  let len = length(wo.xy);
  if (len > 0.0) { return vec3f(wo.xy / len, 0.0); }
  return vec3f(1.0, 0.0, 0.0);
}
fn mx_fuzz_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let ab = mx_fuzz_ltc(ctx.wo.z, ctx.roughness);
  let t = mx_fuzz_tangent(ctx.wo);
  let w = vec3f(ab.x * dot(wi, t) + ab.y * wi.z,
    ab.x * dot(wi, vec3f(-t.y, t.x, 0.0)), wi.z);
  let ratio = ab.x / dot(w, w);
  let densityOverCosine = ratio * ratio / MX_PI;
  return MxBsdfEval(ctx.color * (mx_fuzz_dir_albedo(ctx.wo.z, ctx.roughness) * densityOverCosine), wi.z * densityOverCosine);
}
fn mx_fuzz_sample(ctx: MxLobeCtx, u: vec2f) -> MxBsdfSample {
  if (ctx.wo.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let ab = mx_fuzz_ltc(ctx.wo.z, ctx.roughness);
  let t = mx_fuzz_tangent(ctx.wo);
  let cosine = mx_cosine_hemisphere(u);
  let local = normalize(vec3f((cosine.x - ab.y * cosine.z) / ab.x, cosine.y / ab.x, cosine.z));
  let wi = vec3f(t.x * local.x - t.y * local.y, t.y * local.x + t.x * local.y, local.z);
  let e = mx_fuzz_eval(ctx, wi);
  return MxBsdfSample(wi, e.value, e.pdf, e.pdf > 0.0);
}

// --- coat (dielectric clearcoat layered over the base stack) -------------------
// The coat reflection reuses the dielectric GGX lobe (coat ior/roughness via its
// own MxLobeCtx); these helpers supply the view-dependent darkening the base
// receives under the coat. mx_coat_attenuation returns the per-channel factor
// applied to the base value: the two Fresnel crossings (1 - w*F(cosWo)) *
// (1 - w*F(cosWi)) times MaterialX's mix(white, coat_color, coat_weight).
// Coat weight <= 0 returns vec3f(1.0) so the
// base stays untouched. The full coat-over-base composition lands in the T056h
// assembler.
fn mx_coat_fresnel(ior: f32, cosT: f32) -> f32 {
  let f0 = mx_dielectric_f0(ior);
  let f = pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  return f0 + (1.0 - f0) * f;
}
fn mx_coat_attenuation(coatW: f32, ior: f32, color: vec3f, wo: vec3f, wi: vec3f) -> vec3f {
  if (coatW <= 0.0) { return vec3f(1.0); }
  let fo = mx_coat_fresnel(ior, wo.z);
  let fi = mx_coat_fresnel(ior, wi.z);
  let att = (1.0 - coatW * fo) * (1.0 - coatW * fi);
  let absorb = vec3f(1.0 - coatW) + coatW * color;
  return vec3f(att) * absorb;
}

// --- dielectric transmission (BTDF): refraction + thin-walled (T056e) ---------
// Rough dielectric transmission from the Walter 2007 microfacet BTDF, mirroring
// the CPU oracle src/render/pathtracing/bsdf.ts. ctx.thin selects the thin-walled
// branch (straight-through, both sides, mirror of the microfacet reflection) over
// the refractive branch (Snell bending; the eta^2 half-vector Jacobian stays in
// the pdf but not in the radiance-mode value, so value/pdf carries the 1/eta^2
// compression). Both weight by the dielectric Fresnel transmittance (1 - F) and
// the ctx.color transmission tint. The full-stack assembler lands in T056h.
struct MxRefract {
  dir: vec3f,
  valid: bool,
};
fn mx_fresnel_dielectric(cosI: f32, eta: f32) -> f32 {
  let c = abs(cosI);
  let sin2t = (1.0 - c * c) / (eta * eta);
  if (sin2t >= 1.0) { return 1.0; }
  let cosT = sqrt(1.0 - sin2t);
  let rs = (c - eta * cosT) / (c + eta * cosT);
  let rp = (eta * c - cosT) / (eta * c + cosT);
  return 0.5 * (rs * rs + rp * rp);
}
fn mx_refract_microfacet(wo: vec3f, wm: vec3f, invEta: f32) -> MxRefract {
  let cosI = dot(wo, wm);
  let sin2t = invEta * invEta * max(0.0, 1.0 - cosI * cosI);
  if (sin2t >= 1.0) { return MxRefract(vec3f(0.0), false); }
  let cosT = sqrt(1.0 - sin2t);
  return MxRefract(normalize(-invEta * wo + (invEta * cosI - cosT) * wm), true);
}
// Complete smooth dielectric: Fresnel reflection on the same side OR refraction on
// the far side, with total internal reflection folded into the reflection branch.
// The reflect/refract split carries F / (1 - F) in both value and pdf so the one-
// sample estimator is unbiased and energy-conserving (clear glass, no TIR leaks).
fn mx_transmission_refractive_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z == 0.0 || wi.z == 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let a = mx_alpha_of(ctx.roughness);
  let eta = select(1.0 / ctx.ior, ctx.ior, ctx.wo.z > 0.0);
  if (ctx.wo.z * wi.z > 0.0) {
    // Reflection branch (same hemisphere): microfacet mirror weighted by Fresnel F.
    var wm = normalize(ctx.wo + wi);
    if (dot(ctx.wo, wm) < 0.0) { wm = -wm; }
    let dotO = dot(ctx.wo, wm);
    if (dotO <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
    let f = mx_fresnel_dielectric(dotO, eta);
    let d = mx_ggx_ndf(abs(wm.z), a);
    let g = mx_smith_g1(abs(ctx.wo.z), a) * mx_smith_g1(abs(wi.z), a);
    let scalar = f * d * g / (4.0 * abs(ctx.wo.z) * abs(wi.z));
    let pdf = f * d * abs(wm.z) / (4.0 * dotO);
    return MxBsdfEval(vec3f(scalar), pdf);
  }
  // Refraction branch (far hemisphere): Walter BTDF weighted by (1 - F).
  var wm = normalize(ctx.wo + eta * wi);
  if (wm.z < 0.0) { wm = -wm; }
  let dotO = dot(ctx.wo, wm);
  let dotI = dot(wi, wm);
  let denom = dotO + eta * dotI;
  if (abs(denom) < 1.0e-7) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let f = mx_fresnel_dielectric(dotO, eta);
  let d = mx_ggx_ndf(abs(wm.z), a);
  let g = mx_smith_g1(abs(ctx.wo.z), a) * mx_smith_g1(abs(wi.z), a);
  let geomFactor = (abs(dotO) * abs(dotI)) / (abs(ctx.wo.z) * abs(wi.z));
  let scalar = (1.0 - f) * geomFactor * d * g / (denom * denom);
  let pdf = (1.0 - f) * d * abs(wm.z) * eta * eta * abs(dotI) / (denom * denom);
  return MxBsdfEval(ctx.color * scalar, pdf);
}
fn mx_transmission_thin_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.wo.z == 0.0 || wi.z == 0.0 || ctx.wo.z * wi.z > 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let a = mx_alpha_of(ctx.roughness);
  let s = select(-1.0, 1.0, ctx.wo.z > 0.0);
  let woU = vec3f(ctx.wo.x, ctx.wo.y, s * ctx.wo.z);
  let wiU = vec3f(wi.x, wi.y, -s * wi.z);
  let wm = normalize(woU + wiU);
  let cosVH = dot(woU, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let f = mx_fresnel_dielectric(cosVH, ctx.ior);
  let d = mx_ggx_ndf(wm.z, a);
  let g = mx_smith_g1(woU.z, a) * mx_smith_g1(wiU.z, a);
  let scalar = (1.0 - f) * d * g / (4.0 * woU.z * wiU.z);
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(ctx.color * scalar, pdf);
}
fn mx_dielectric_transmission_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval {
  if (ctx.thin > 0.0) { return mx_transmission_thin_eval(ctx, wi); }
  return mx_transmission_refractive_eval(ctx, wi);
}
fn mx_dielectric_transmission_pdf(ctx: MxLobeCtx, wi: vec3f) -> f32 {
  return mx_dielectric_transmission_eval(ctx, wi).pdf;
}
fn mx_dielectric_transmission_sample(ctx: MxLobeCtx, u: vec3f) -> MxBsdfSample {
  let a = mx_alpha_of(ctx.roughness);
  if (ctx.thin > 0.0) {
    let s = select(-1.0, 1.0, ctx.wo.z > 0.0);
    let woU = vec3f(ctx.wo.x, ctx.wo.y, s * ctx.wo.z);
    let wm = mx_sample_ggx_normal(a, u.xy);
    let wrU = reflect(-woU, wm);
    if (wrU.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    let wi = vec3f(wrU.x, wrU.y, -s * wrU.z);
    let e = mx_transmission_thin_eval(ctx, wi);
    if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    return MxBsdfSample(wi, e.value, e.pdf, true);
  }
  var wm = mx_sample_ggx_normal(a, u.xy);
  if (ctx.wo.z < 0.0) { wm = -wm; }
  if (dot(ctx.wo, wm) <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let eta = select(1.0 / ctx.ior, ctx.ior, ctx.wo.z > 0.0);
  let f = mx_fresnel_dielectric(dot(ctx.wo, wm), eta);
  let invEta = select(ctx.ior, 1.0 / ctx.ior, ctx.wo.z > 0.0);
  let r = mx_refract_microfacet(ctx.wo, wm, invEta);
  // Total internal reflection (invalid refraction) or the Fresnel coin flip both
  // reflect; otherwise refract. u.z is the free reflect/refract random.
  if (!r.valid || u.z < f) {
    let wi = reflect(-ctx.wo, wm);
    if (ctx.wo.z * wi.z <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    let e = mx_transmission_refractive_eval(ctx, wi);
    if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    return MxBsdfSample(wi, e.value, e.pdf, true);
  }
  if (ctx.wo.z * r.dir.z > 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let e = mx_transmission_refractive_eval(ctx, r.dir);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(r.dir, e.value, e.pdf, true);
}

// --- thin film (Airy interference on the specular Fresnel, T056f) --------------
// A thin dielectric film over the specular interface produces view- and
// wavelength-dependent iridescence. mx_thin_film_tint mirrors the CPU oracle
// (src/render/pathtracing/spectrum.ts thinFilmTint): per RGB primary wavelength it
// derives the real substrate index reproducing the lobe's F0 and evaluates the
// exact angle-correct Airy reflectance (unpolarised s/p average). mx_thin_film_fresnel
// blends this iridescent reflectance with the nominal Schlick Fresnel by the film
// weight; an inactive film (weight 0 or thickness 0) returns the nominal Fresnel
// unchanged (non-regression). The full-stack assembler wires this onto the
// specular lobes in T056h.
fn mx_fresnel_s(na: f32, cosA: f32, nb: f32, cosB: f32) -> f32 {
  return (na * cosA - nb * cosB) / (na * cosA + nb * cosB);
}
fn mx_fresnel_p(na: f32, cosA: f32, nb: f32, cosB: f32) -> f32 {
  return (nb * cosA - na * cosB) / (nb * cosA + na * cosB);
}
fn mx_airy(r01: f32, r12: f32, phi: f32) -> f32 {
  let cp = cos(phi);
  let sp = sin(phi);
  let numRe = r01 + r12 * cp;
  let numIm = r12 * sp;
  let denRe = 1.0 + r01 * r12 * cp;
  let denIm = r01 * r12 * sp;
  let num = numRe * numRe + numIm * numIm;
  let den = denRe * denRe + denIm * denIm;
  return select(1.0, num / den, den > 0.0);
}
fn mx_thin_film_reflectance(lambda: f32, thickness: f32, cosTheta0: f32, n0: f32, n1: f32, n2: f32) -> f32 {
  let c0 = clamp(cosTheta0, 0.0, 1.0);
  let sin0sq = 1.0 - c0 * c0;
  let sin1sq = (n0 / n1) * (n0 / n1) * sin0sq;
  let sin2sq = (n0 / n2) * (n0 / n2) * sin0sq;
  if (sin1sq >= 1.0 || sin2sq >= 1.0) { return 1.0; }
  let c1 = sqrt(1.0 - sin1sq);
  let c2 = sqrt(1.0 - sin2sq);
  let phi = 4.0 * MX_PI * n1 * thickness * c1 / lambda;
  let rs = mx_airy(mx_fresnel_s(n0, c0, n1, c1), mx_fresnel_s(n1, c1, n2, c2), phi);
  let rp = mx_airy(mx_fresnel_p(n0, c0, n1, c1), mx_fresnel_p(n1, c1, n2, c2), phi);
  return 0.5 * (rs + rp);
}
fn mx_thin_film_channel(lambda: f32, thickness: f32, cosTheta0: f32, filmIor: f32, f0c: f32) -> f32 {
  let s = sqrt(clamp(f0c, 0.0, 0.9999));
  let n2 = (1.0 + s) / (1.0 - s);
  return mx_thin_film_reflectance(lambda, thickness, cosTheta0, 1.0, filmIor, n2);
}
fn mx_thin_film_tint(thickness: f32, cosTheta0: f32, filmIor: f32, f0: vec3f) -> vec3f {
  return vec3f(
    mx_thin_film_channel(612.0, thickness, cosTheta0, filmIor, f0.x),
    mx_thin_film_channel(549.0, thickness, cosTheta0, filmIor, f0.y),
    mx_thin_film_channel(465.0, thickness, cosTheta0, filmIor, f0.z),
  );
}
fn mx_thin_film_fresnel(baseFresnel: vec3f, baseF0: vec3f, cosVH: f32, weight: f32, thickness: f32, filmIor: f32) -> vec3f {
  if (weight <= 0.0 || thickness <= 0.0) { return baseFresnel; }
  let tint = mx_thin_film_tint(thickness, cosVH, filmIor, baseF0);
  return mix(baseFresnel, tint, clamp(weight, 0.0, 1.0));
}

// --- thin-film specular cores (thin-film Fresnel applied to the GGX reflection) --
// Mirror mx_microfacet_eval / mx_microfacet_eval_aniso but swap the Schlick
// Fresnel for its thin-film modulation. The sampled DIRECTION is unchanged (it
// depends only on the GGX alpha), so the assembler keeps the base samplers and
// re-evaluates the value through these when a thin film is active (mirrors the
// CPU conductorThinFilmLobe / dielectricThinFilmLobe in bsdf.ts).
fn mx_microfacet_eval_tf(wo: vec3f, wi: vec3f, a: f32, f0: vec3f, filmW: f32, filmT: f32, filmIor: f32) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm0 = wo + wi;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wo, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf(wm.z, a);
  let g = mx_smith_g1(wo.z, a) * mx_smith_g1(wi.z, a);
  let f = mx_thin_film_fresnel(mx_fresnel_schlick(f0, cosVH), f0, cosVH, filmW, filmT, filmIor);
  let value = f * (d * g / (4.0 * wo.z * wi.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}
fn mx_microfacet_eval_aniso_tf(wo: vec3f, wi: vec3f, alpha: vec2f, rotation: f32, f0: vec3f, filmW: f32, filmT: f32, filmIor: f32) -> MxBsdfEval {
  if (wo.z <= 0.0 || wi.z <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wor = mx_rotate_tangent(wo, rotation);
  let wir = mx_rotate_tangent(wi, rotation);
  let wm0 = wor + wir;
  if (dot(wm0, wm0) <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let wm = normalize(wm0);
  let cosVH = dot(wor, wm);
  if (cosVH <= 0.0) { return MxBsdfEval(vec3f(0.0), 0.0); }
  let d = mx_ggx_ndf_aniso(wm, alpha);
  let g = mx_smith_g1_aniso(wor, alpha) * mx_smith_g1_aniso(wir, alpha);
  let f = mx_thin_film_fresnel(mx_fresnel_schlick(f0, cosVH), f0, cosVH, filmW, filmT, filmIor);
  let value = f * (d * g / (4.0 * wor.z * wir.z));
  let pdf = d * wm.z / (4.0 * cosVH);
  return MxBsdfEval(value, pdf);
}

// --- full-stack closure assembler (mirror of composeLobes + coatOverBase, T056h) --
// Operates on the LayeredClosure struct emitted by the surface compiler
// (LAYERED_CLOSURE_PRELUDE in surface-wgsl.ts, prepended before this library).
// mx_closure_eval/pdf/sample mirror the CPU oracle: composeLobes one-sample MIS
// over the weighted lobe stack (value = sum w_k f_k, pdf = sum (w_k/total) pdf_k)
// then coatOverBase (dielectric clearcoat with Fresnel/absorption attenuation).
// Sheen and fuzz ride in the lobe array as sheen lobes; an active thin film
// modulates the specular lobes' Fresnel. Wired onto the backends in T057/T058;
// device parity checked in T059.
fn mx_closure_lobe_ctx(lobe: MxBsdfLobe, wo: vec3f) -> MxLobeCtx {
  return MxLobeCtx(wo, lobe.color, lobe.roughness, lobe.ior, lobe.anisotropy, lobe.rotation, lobe.thin);
}
${si(oi)}
fn mx_closure_total_weight(c: LayeredClosure) -> f32 {
  var total = 0.0;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) { total = total + c.lobes[i].weight; }
  return total;
}
fn mx_closure_has_dispersion(c: LayeredClosure) -> bool {
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.weight > 0.0 && l.dispersion > 0.0 && l.thin == 0.0) {
      return true;
    }
  }
  return false;
}
fn mx_dispersion_ior(ior: f32, dispersion: f32, channel: u32) -> f32 {
  return max(1.0, ior + (f32(channel) - 1.0) * (ior - 1.0) * 0.025 * max(dispersion, 0.0));
}
fn mx_closure_spectral_channel(c: LayeredClosure, channel: u32) -> LayeredClosure {
  var result = c;
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    if (l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin == 0.0 && l.dispersion > 0.0) {
      result.lobes[i].ior = mx_dispersion_ior(l.ior, l.dispersion, channel);
    }
  }
  return result;
}
${b}
fn mx_closure_has_hair(c: LayeredClosure) -> bool {
  for (var i = 0u; i < c.lobeCount; i++) {
    if (c.lobes[i].kind == MX_LOBE_CHIANG_HAIR && c.lobes[i].weight > 0.0) { return true; }
  }
  return false;
}
fn mx_closure_frame(c: LayeredClosure, n: vec3f, fallback: mat3x3f) -> mat3x3f {
  if (c.hasShadingTangent == 0u) { return fallback; }
  let t = c.shadingTangent - n * dot(c.shadingTangent, n);
  if (dot(t, t) < 1e-10) { return fallback; }
  let tangent = normalize(t);
  return mat3x3f(tangent, cross(n, tangent), n);
}
fn mx_closure_shading_normal(c: LayeredClosure, geometricNormal: vec3f) -> vec3f {
  if (c.hasShadingNormal != 0u && dot(c.shadingNormal, c.shadingNormal) > 1e-12) {
    return normalize(c.shadingNormal);
  }
  return geometricNormal;
}
fn mx_closure_oriented_normal(c: LayeredClosure, n: vec3f, viewDir: vec3f) -> vec3f {
  if (dot(n, viewDir) >= 0.0) { return n; }
  for (var i = 0u; i < c.lobeCount; i++) {
    let l = c.lobes[i];
    // Solid glass needs the signed interface normal to distinguish entering
    // from exiting. Opaque backfaces exposed by cutouts must still scatter.
    if (l.weight > 0.0 && l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin == 0.0) {
      return n;
    }
  }
  return -n;
}
fn mx_closure_base_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let total = mx_closure_total_weight(c);
  var value = vec3f(0.0);
  var pdf = 0.0;
  if (total <= 0.0) { return MxBsdfEval(value, pdf); }
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let lobe = c.lobes[i];
    if (lobe.weight <= 0.0) { continue; }
    let r = mx_closure_lobe_eval(lobe, c, wo, wi);
    value = value + r.value * lobe.weight;
    pdf = pdf + (lobe.weight / total) * r.pdf;
  }
  return MxBsdfEval(value, pdf);
}
fn mx_closure_coat_ctx(c: LayeredClosure, wo: vec3f) -> MxLobeCtx {
  return MxLobeCtx(wo, vec3f(0.0), c.coat.roughness, c.coat.ior, 0.0, 0.0, 0.0);
}
fn mx_closure_eval_base(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  let base = mx_closure_base_eval(c, wo, wi);
  if (c.hasCoat == 0u || c.coat.weight <= 0.0) { return base; }
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  let cc = mx_dielectric_reflection_eval(mx_closure_coat_ctx(c, wo), wi);
  let att = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, wi);
  let pCoat = min(coatW * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
  let value = coatW * cc.value + att * base.value;
  let pdf = pCoat * cc.pdf + (1.0 - pCoat) * base.pdf;
  return MxBsdfEval(value, pdf);
}
${li}
fn mx_closure_fuzz_coverage(c: LayeredClosure, wo: vec3f) -> f32 {
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0 || wo.z <= 0.0) { return 0.0; }
  return clamp(c.fuzz.weight, 0.0, 1.0) * mx_fuzz_dir_albedo(wo.z, c.fuzz.roughness);
}
fn mx_closure_pdf(c: LayeredClosure, wo: vec3f, wi: vec3f) -> f32 {
  return mx_closure_eval(c, wo, wi).pdf;
}
fn mx_closure_base_direction(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let total = mx_closure_total_weight(c);
  // wo.z < 0 means a ray inside a refractive medium hitting the surface from the
  // dense side; the transmission lobe handles that, so only reject grazing.
  if (total <= 0.0 || wo.z == 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  var pick = u.z * total;
  var chosen = 0u;
  var found = false;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let w = c.lobes[i].weight;
    if (w <= 0.0) { continue; }
    if (!found) {
      chosen = i;
      if (pick < w) { found = true; } else { pick = pick - w; }
    }
  }
  return mx_closure_lobe_sample(c.lobes[chosen], wo, u);
}
fn mx_closure_base_sample(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  let s = mx_closure_base_direction(c, wo, u);
  if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  let e = mx_closure_base_eval(c, wo, s.wi);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(s.wi, e.value, e.pdf, true);
}
// A closure whose energy is carried entirely by smooth dielectric lobes (clear
// glass / mirror) behaves like a delta BSDF: next-event estimation can never
// hit its sharp refraction/reflection lobe, so NEE only injects fireflies that
// the firefly clamp later removes (losing energy and darkening the glass).
// The integrator uses this to skip NEE and treat the bounce as specular, letting
// the environment be seen directly through the glass at full weight.
fn mx_closure_is_specular(c: LayeredClosure) -> bool {
  if (c.hasCoat != 0u && c.coat.weight > 0.0) { return false; }
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) { return false; }
  var w = 0.0;
  var spec = 0.0;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    w = w + l.weight;
    if ((l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION || l.kind == MX_LOBE_DIELECTRIC_REFLECTION) && l.roughness < 0.07) {
      spec = spec + l.weight;
    }
  }
  return w > 0.0 && spec >= w * 0.999;
}
// Diffuse albedo carried by the non-specular lobes (oren-nayar/burley/translucent
// /sheen/subsurface). The integrator lights these from the SH9 irradiance probe
// (noise-free) instead of sampling the environment, so this returns the summed
// weighted lobe colour the probe is modulated by.
fn mx_closure_diffuse_albedo(c: LayeredClosure, wo: vec3f) -> vec3f {
  var a = vec3f(0.0);
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind == MX_LOBE_OREN_NAYAR_DIFFUSE || l.kind == MX_LOBE_BURLEY_DIFFUSE
        || l.kind == MX_LOBE_TRANSLUCENT || l.kind == MX_LOBE_SHEEN
        || l.kind == MX_LOBE_SUBSURFACE) {
      a = a + l.color * l.weight;
    }
  }
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) {
    let coverage = mx_closure_fuzz_coverage(c, wo);
    a = a * (1.0 - coverage) + c.fuzz.color * coverage;
  }
  return a;
}
// True when a BSDF sample drawn with random scalar uz picks a diffuse lobe (lit by
// the SH probe, so the integrator suppresses its env miss), including LTC fuzz.
fn mx_closure_sampled_is_diffuse(c: LayeredClosure, wo: vec3f, uz: f32) -> bool {
  var pz = uz;
  if (c.hasFuzz != 0u && c.fuzz.weight > 0.0 && wo.z > 0.0) {
    let coverage = mx_closure_fuzz_coverage(c, wo);
    if (uz < coverage) { return true; }
    pz = (uz - coverage) / max(1.0 - coverage, 1.0e-6);
  }
  if (c.hasCoat != 0u && c.coat.weight > 0.0) {
    let pCoat = min(clamp(c.coat.weight, 0.0, 1.0) * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
    if (uz < pCoat) { return false; }
    pz = (uz - pCoat) / max(1.0 - pCoat, 1.0e-6);
  }
  let total = mx_closure_total_weight(c);
  if (total <= 0.0) { return false; }
  var pick = pz * total;
  var chosen = 0u;
  var found = false;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let w = c.lobes[i].weight;
    if (w <= 0.0) { continue; }
    if (!found) {
      chosen = i;
      if (pick < w) { found = true; } else { pick = pick - w; }
    }
  }
  let k = c.lobes[chosen].kind;
  return k == MX_LOBE_OREN_NAYAR_DIFFUSE || k == MX_LOBE_BURLEY_DIFFUSE
      || k == MX_LOBE_TRANSLUCENT || k == MX_LOBE_SHEEN || k == MX_LOBE_SUBSURFACE;
}
// Specular-only closure response: the dielectric/conductor/schlick reflection
// lobes, the glass transmission lobe and the dielectric coat. The diffuse lobes
// are excluded (lit by the SH probe) so the environment NEE keeps importance
// sampling only the glossy/coat reflections (reflets du vernis).
fn mx_closure_specular_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval {
  var specTotal = 0.0;
  for (var i = 0u; i < c.lobeCount; i = i + 1u) {
    let l = c.lobes[i];
    if (l.weight <= 0.0) { continue; }
    if (l.kind == MX_LOBE_DIELECTRIC_REFLECTION || l.kind == MX_LOBE_CONDUCTOR
        || l.kind == MX_LOBE_GENERALIZED_SCHLICK || l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION
        || l.kind == MX_LOBE_CHIANG_HAIR) {
      specTotal = specTotal + l.weight;
    }
  }
  var value = vec3f(0.0);
  var pdf = 0.0;
  if (specTotal > 0.0) {
    for (var i = 0u; i < c.lobeCount; i = i + 1u) {
      let lobe = c.lobes[i];
      if (lobe.weight <= 0.0) { continue; }
      if (!(lobe.kind == MX_LOBE_DIELECTRIC_REFLECTION || lobe.kind == MX_LOBE_CONDUCTOR
          || lobe.kind == MX_LOBE_GENERALIZED_SCHLICK || lobe.kind == MX_LOBE_DIELECTRIC_TRANSMISSION
          || lobe.kind == MX_LOBE_CHIANG_HAIR)) { continue; }
      let r = mx_closure_lobe_eval(lobe, c, wo, wi);
      value = value + r.value * lobe.weight;
      pdf = pdf + (lobe.weight / specTotal) * r.pdf;
    }
  }
  var base = MxBsdfEval(value, pdf);
  if (c.hasCoat != 0u && c.coat.weight > 0.0) {
    let coatW = clamp(c.coat.weight, 0.0, 1.0);
    let cc = mx_dielectric_reflection_eval(mx_closure_coat_ctx(c, wo), wi);
    let att = mx_coat_attenuation(coatW, c.coat.ior, c.coat.color, wo, wi);
    let pCoat = min(coatW * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
    base = MxBsdfEval(
      coatW * cc.value + att * base.value,
      pCoat * cc.pdf + (1.0 - pCoat) * base.pdf,
    );
  }
  if (c.hasFuzz == 0u || c.fuzz.weight <= 0.0) { return base; }
  let coverage = mx_closure_fuzz_coverage(c, wo);
  return MxBsdfEval(base.value * (1.0 - coverage), mx_closure_pdf(c, wo, wi));
}
fn mx_closure_sample_base(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample {
  if (wo.z == 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  if (c.hasCoat == 0u || c.coat.weight <= 0.0) { return mx_closure_base_sample(c, wo, u); }
  let coatW = clamp(c.coat.weight, 0.0, 1.0);
  let pCoat = min(coatW * mx_coat_fresnel(c.coat.ior, wo.z), 0.95);
  var wi: vec3f;
  if (u.z < pCoat) {
    let s = mx_dielectric_reflection_sample(mx_closure_coat_ctx(c, wo), u.xy);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  } else {
    let ru = vec3f(u.x, u.y, (u.z - pCoat) / max(1.0 - pCoat, 1.0e-6));
    let s = mx_closure_base_direction(c, wo, ru);
    if (!s.valid) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
    wi = s.wi;
  }
  let e = mx_closure_eval_base(c, wo, wi);
  if (e.pdf <= 0.0) { return MxBsdfSample(vec3f(0.0), vec3f(0.0), 0.0, false); }
  return MxBsdfSample(wi, e.value, e.pdf, true);
}
${ui}`,fi=class extends Error{name=`WgslEmitError`},pi=`mx_shade`;function mi(e){let t=e.replace(/[^A-Za-z0-9_]/g,`_`);return/^[0-9]/.test(t)?`_${t}`:t}function hi(e){switch(e.kind){case`scalar`:return e.scalar===`float`?`f32`:e.scalar===`int`?`i32`:`bool`;case`vector`:{let t=e.scalar===`float`?`f`:e.scalar===`int`?`i`:`u`;return`vec${e.size}${t}`}case`matrix`:return`mat${e.size}x${e.size}f`;case`closure`:case`shader`:return`Closure`;case`string`:case`filename`:throw new fi(`type ${e.kind} has no WGSL representation`)}}function gi(e){if(!Number.isFinite(e))throw new fi(`non-finite float literal ${e}`);return Number.isInteger(e)?`${e}.0`:`${e}`}function _i(e,t){switch(e.kind){case`scalar`:return e.scalar===`bool`?t?`true`:`false`:e.scalar===`int`?`${Math.trunc(t)}`:gi(t);case`vector`:{let n=t;return`${hi(e)}(${n.map(gi).join(`, `)})`}case`matrix`:{let n=Array.isArray(t)?t:[];return n.length===e.size*e.size?`${hi(e)}(${n.map(gi).join(`, `)})`:Si(e.size)}default:throw new fi(`cannot emit constant of type ${e.kind}`)}}function vi(e){switch(e.kind){case`const`:case`param`:case`input`:case`primvar`:return[];case`convert`:case`swizzle`:return[e.source];case`texture`:{let t=[e.uv];return e.lod&&t.push(e.lod),e.bias&&t.push(e.bias),e.gradient&&t.push(e.gradient.ddx,e.gradient.ddy),t}case`call`:return[...e.args,...Object.values(e.namedArgs??{})];case`closure`:return Object.values(e.params);case`combine`:return e.weight?[...e.operands,e.weight]:[...e.operands]}}function yi(e){let t=[],n=new Map,r=i=>{let a=n.get(i);if(a===`done`)return;if(a===`visiting`)throw new fi(`cycle in IR at ${i}`);let o=e.exprs.get(i);if(!o)throw new fi(`dangling IR reference ${i}`);n.set(i,`visiting`);for(let e of vi(o))r(e);n.set(i,`done`),t.push(i)};for(let t of e.outputs)r(t.ref);return t}function bi(e,t,n=!1,r={}){return{at(t,n){let r=e[t];if(r!==void 0)return r;if(n!==void 0)return n;throw new fi(`missing positional argument ${t}`)},named(r,i,a){let o=t[r]??(!n&&a!==void 0?e[a]:void 0);if(o!==void 0)return o;if(i!==void 0)return i;throw new fi(`missing named input '${r}'`)},has(e){return t[e]!==void 0},typeOf(e){return r[e]}}}function xi(e,t){if(t!==void 0){if(typeof t==`string`)e.add(t);else for(let n of t)e.add(n)}}function Si(e){let t=[];for(let n=0;n<e;n++)for(let r=0;r<e;r++)t.push(n===r?`1.0`:`0.0`);return`mat${e}x${e}f(${t.join(`, `)})`}function Ci(e,t,n){if(n.kind===`matrix`)return t.kind===`matrix`&&t.size===n.size?e:Si(n.size);if(n.kind===`vector`){let r=hi(n);if(t.kind===`scalar`)return`${r}(${t.scalar===n.scalar?e:`${hi({kind:`scalar`,scalar:n.scalar})}(${e})`})`;if(t.kind===`vector`){let i=(e,r)=>t.scalar===n.scalar?e:`${hi({kind:`vector`,scalar:n.scalar,size:r})}(${e})`;if(t.size===n.size)return i(e,n.size);if(t.size<n.size){let a=[];for(let e=t.size;e<n.size;e++)a.push(e===3?`1.0`:`0.0`);return`${r}(${i(e,t.size)}, ${a.join(`, `)})`}return i(`${e}.${`xyzw`.slice(0,n.size)}`,n.size)}return`${r}(0.0)`}if(n.kind===`scalar`){let r=t.kind===`vector`?`${e}.x`:e,i=t.kind===`vector`||t.kind===`scalar`?t.scalar:n.scalar;return t.kind!==`vector`&&t.kind!==`scalar`?n.scalar===`bool`?`false`:`${hi(n)}(0)`:i===n.scalar?r:n.scalar===`bool`?`(${r} != ${i===`float`?`0.0`:`0`})`:`${hi(n)}(${r})`}return e}function wi(e,t,n,r){let i=`${n}tex_${mi(e.texture)}`,a=`${n}samp_${mi(e.sampler)}`,o=t(e.uv),s;return s=e.gradient?`textureSampleGrad(${i}, ${a}, ${o}, ${t(e.gradient.ddx)}, ${t(e.gradient.ddy)})`:e.lod?`textureSampleLevel(${i}, ${a}, ${o}, ${t(e.lod)})`:e.bias?`textureSampleBias(${i}, ${a}, ${o}, ${t(e.bias)})`:r?`textureSampleLevel(${i}, ${a}, ${o}, 0.0)`:`textureSample(${i}, ${a}, ${o})`,e.type.kind===`vector`?e.type.size===4?s:`(${s}).${`rgba`.slice(0,e.type.size)}`:`(${s}).r`}var Ti=new Set([`position`,`normal`,`tangent`,`bitangent`,`texcoord`]);function Ei(e){let t=e.toLowerCase();return Ti.has(t)?`vary.${t}`:t===`view`||t===`viewdir`||t===`viewdirection`?`vary.viewDir`:`vary.in_${mi(e)}`}function Di(e,t=``,n=!1,r){let i=e=>r?`(${e} + ${r.offset})`:e,a={varyings:{position:`vary.position`,normal:`vary.normal`,tangent:`vary.tangent`,bitangent:`vary.bitangent`,texcoord:i(`vary.texcoord`),viewDir:`vary.viewDir`},wgslType:hi,computeStage:n},o=yi(e),s=e=>`${r?.prefix??``}${e}`,c=new Set([En]),l=new Set,u=new Set,d=new Map,f=new Map,p=[],m=!1;for(let h of o){let o=e.exprs.get(h),g;switch(o.kind){case`const`:g=_i(o.type,o.value);break;case`param`:g=`u.${t}${mi(o.name)}`;break;case`input`:{let e=Ei(o.name);e.startsWith(`vary.in_`)&&d.set(o.name,o.type),g=o.name.toLowerCase()===`texcoord`?i(e):e;break}case`primvar`:g=o.name===`st`?i(`vary.v_${mi(o.name)}`):`vary.v_${mi(o.name)}`,f.set(o.name,o.type);break;case`convert`:g=Ci(s(o.source),o.from,o.type);break;case`swizzle`:g=`${s(o.source)}.${o.pattern}`;break;case`texture`:g=wi(o,s,t,n),l.add(o.texture),u.add(o.sampler);break;case`call`:{let n=fr(o.op);if(!n)throw new fi(`no WGSL lowering for node '${o.op}'`);if(xi(c,n.prelude),o.op===`heighttonormal`){let n=o.namedArgs?.in??o.args[0];if(!n)throw new fi(`${o.op} requires a height input`);let i=e.exprs.get(n);if(!i)throw new fi(`missing height expression '${n}'`);let a=o.namedArgs?.texcoord,_={...e,outputs:[{name:`height`,type:i.type,ref:n},...a?[{name:`texcoord`,type:e.exprs.get(a).type,ref:a}]:[]]},v=yi(_).map(t=>e.exprs.get(t)).find(e=>e?.kind===`texture`),y=v?.kind===`texture`?`(1.0 / vec2f(textureDimensions(${t}tex_${mi(v.texture)}, 0)))`:`vec2f(0.0009765625)`,b=`${s(h)}_step`;p.push(`  let ${b} = ${y};`);let x=[],S=[];for(let[e,i]of[[0,1],[0,-1],[1,1],[1,-1]]){let o=e===0?`vec2f(${i}.0 * ${b}.x, 0.0)`:`vec2f(0.0, ${i}.0 * ${b}.y)`,g=`${s(h)}_${e}_${i>0?`p`:`m`}_`,v=Di(_,t,!0,{prefix:g,offset:r?`(${r.offset} + ${o})`:o});p.push(...v.body);for(let e of v.preludes)c.add(e);for(let e of v.textures)l.add(e.name);for(let e of v.samplers)u.add(e.name);for(let[e,t]of v.primvarFields)f.set(e,t);for(let[e,t]of v.extraInputs)d.set(e,t);m||=v.usesLighting,x.push(`${g}${n}`),a&&S.push(`${g}${a}`)}let C=`vec2f((${x[0]} - ${x[1]}) / (2.0 * ${b}.x), (${x[2]} - ${x[3]}) / (2.0 * ${b}.y))`,w=o.namedArgs?.scale?s(o.namedArgs.scale):`1.0`,T=`vec2f(1.0, 0.0)`,E=`vec2f(0.0, 1.0)`;if(a){let e=`${s(h)}_uv_dx`,t=`${s(h)}_uv_dy`;p.push(`  let ${e} = (${S[0]} - ${S[1]}) / (2.0 * ${b}.x);`),p.push(`  let ${t} = (${S[2]} - ${S[3]}) / (2.0 * ${b}.y);`),T=`vec2f(${e}.x, ${t}.x)`,E=`vec2f(${e}.y, ${t}.y)`}g=`mx_heighttonormal(${C}, ${T}, ${E}, ${w})`;break}let i=Object.fromEntries(Object.entries(o.namedArgs??{}).map(([e,t])=>[e,s(t)])),_={};for(let[t,n]of Object.entries(o.namedArgs??{})){let r=e.exprs.get(n);r&&(_[t]=r.type)}g=n.emit(bi(o.args.map(s),i,o.namedArgs!==void 0,_),o.type,a);break}case`closure`:{let e=fr(o.op);if(!e)throw new fi(`no WGSL lowering for closure '${o.op}'`);jn(o.op)&&(c.add(Dn),m=!0),xi(c,e.prelude);let t={};for(let[e,n]of Object.entries(o.params))t[e]=s(n);g=e.emit(bi([],t),o.type,a);break}case`combine`:g=ki(o,s)}p.push(`  let ${s(h)} = ${g};`)}let h=e.params.map(e=>({name:e.name,field:`${t}${mi(e.name)}`,wgslType:hi(e.type)})),g=e.textures.filter(e=>l.has(e.name)),_=e.samplers.filter(e=>u.has(e.name)),v=g.map((e,n)=>({name:e.name,handle:`${t}tex_${mi(e.name)}`,group:1,binding:n,...e.fileRef===void 0?{}:{fileRef:e.fileRef},...e.colorSpace===void 0?{}:{colorSpace:e.colorSpace}})),y=_.map(({name:e,...n},r)=>({name:e,handle:`${t}samp_${mi(e)}`,group:2,binding:r,...Object.keys(n).length>0?{sampler:n}:{}}));return{order:o,body:p,preludes:c,extraInputs:d,primvarFields:f,usesLighting:m,uniforms:h,textures:v,samplers:y}}function Oi(e){let{uniforms:t,textures:n,samplers:r,preludes:i,primvarFields:a,extraInputs:o,body:s,usesLighting:c}=Di(e),l=new Set,u=e.outputs.map(e=>{let t=mi(e.name);for(;l.has(t);)t=`${t}_`;return l.add(t),{name:e.name,field:t,wgslType:hi(e.type)}});return{code:ji({uniforms:t,textures:n,samplers:r,outputs:u,outputAssigns:e.outputs.map((e,t)=>({field:u[t].field,ref:e.ref})),preludes:i,primvarFields:a,extraInputs:o,body:s}),entryPoint:pi,uniforms:t,textures:n,samplers:r,outputs:u,...c?{lighting:{group:0,binding:1}}:{}}}function ki(e,t){let n=e.operands.map(t);if(e.type.kind===`closure`||e.type.kind===`shader`)switch(e.op){case`add`:return n.reduce((e,t)=>`mx_closure_add(${e}, ${t})`);case`mix`:return`mx_closure_mix(${n[0]}, ${n[1]}, ${e.weight?t(e.weight):`0.5`})`;case`multiply`:return`mx_closure_mul(${n[0]}, ${n[1]}.color)`;case`layer`:return`mx_layer(${n[0]}, ${n[1]})`}switch(e.op){case`add`:return`(${n.join(` + `)})`;case`multiply`:return`(${n.join(` * `)})`;case`mix`:return`mix(${n[0]}, ${n[1]}, ${e.weight?t(e.weight):`0.5`})`;case`layer`:return`(${n.join(` + `)})`;default:throw new fi(`unsupported combine op`)}}function Ai(e,t){let n=[`  position: vec3f,`,`  normal: vec3f,`,`  tangent: vec3f,`,`  bitangent: vec3f,`,`  texcoord: vec2f,`,`  viewDir: vec3f,`];for(let[t,r]of e)n.push(`  v_${mi(t)}: ${hi(r)},`);for(let[e,r]of t)n.push(`  in_${mi(e)}: ${hi(r)},`);return`struct MxVaryings {\n${n.join(`
`)}\n};`}function ji(e){let t=[];t.push([...e.preludes].join(`
`)),e.uniforms.length>0&&t.push(`struct MxUniforms {\n${e.uniforms.map(e=>`  ${e.field}: ${e.wgslType},`).join(`
`)}\n};\n@group(0) @binding(0) var<uniform> u: MxUniforms;`);for(let n of e.textures)t.push(`@group(${n.group}) @binding(${n.binding}) var ${n.handle}: texture_2d<f32>;`);for(let n of e.samplers)t.push(`@group(${n.group}) @binding(${n.binding}) var ${n.handle}: sampler;`);t.push(Ai(e.primvarFields,e.extraInputs)),t.push(`struct MxOutputs {\n${e.outputs.map(e=>`  ${e.field}: ${e.wgslType},`).join(`
`)}\n};`);let n=e.outputAssigns.map(e=>`  result.${e.field} = ${e.ref};`);return t.push(`fn ${pi}(vary: MxVaryings) -> MxOutputs {\n${e.body.join(`
`)}\n  var result: MxOutputs;\n${n.join(`
`)}\n  return result;\n}`),t.join(`

`)+`
`}var Mi=`mx_surface_layered`,Ni=`LayeredClosure`,Pi={chiang_hair:`MX_LOBE_CHIANG_HAIR`,oren_nayar_diffuse:`MX_LOBE_OREN_NAYAR_DIFFUSE`,burley_diffuse:`MX_LOBE_BURLEY_DIFFUSE`,translucent:`MX_LOBE_TRANSLUCENT`,dielectric_reflection:`MX_LOBE_DIELECTRIC_REFLECTION`,dielectric_transmission:`MX_LOBE_DIELECTRIC_TRANSMISSION`,conductor:`MX_LOBE_CONDUCTOR`,generalized_schlick:`MX_LOBE_GENERALIZED_SCHLICK`,sheen:`MX_LOBE_SHEEN`,subsurface:`MX_LOBE_SUBSURFACE`},Fi={chiang_hair:9,oren_nayar_diffuse:0,burley_diffuse:1,translucent:2,dielectric_reflection:3,conductor:4,generalized_schlick:5,sheen:6,subsurface:7,dielectric_transmission:8},Ii=`const MX_MAX_LOBES: u32 = 8u;
const MX_LOBE_OREN_NAYAR_DIFFUSE: u32 = 0u;
const MX_LOBE_BURLEY_DIFFUSE: u32 = 1u;
const MX_LOBE_TRANSLUCENT: u32 = 2u;
const MX_LOBE_DIELECTRIC_REFLECTION: u32 = 3u;
const MX_LOBE_CONDUCTOR: u32 = 4u;
const MX_LOBE_GENERALIZED_SCHLICK: u32 = 5u;
const MX_LOBE_SHEEN: u32 = 6u;
const MX_LOBE_SUBSURFACE: u32 = 7u;
const MX_LOBE_DIELECTRIC_TRANSMISSION: u32 = 8u;
const MX_LOBE_CHIANG_HAIR: u32 = 9u;
struct MxBsdfLobe {
  kind: u32,
  weight: f32,
  color: vec3f,
  color90: vec3f,
  roughness: f32,
  anisotropy: f32,
  rotation: f32,
  ior: f32,
  extinction: vec3f,
  thin: f32,
  dispersion: f32,
  hairTintTRT: vec3f,
};
struct MxCoatLayer { weight: f32, color: vec3f, roughness: f32, ior: f32 };
struct MxSheenLayer { weight: f32, color: vec3f, roughness: f32 };
struct MxFuzzLayer { weight: f32, color: vec3f, roughness: f32 };
struct MxThinFilmLayer { weight: f32, thickness: f32, ior: f32 };
struct LayeredClosure {
  lobes: array<MxBsdfLobe, MX_MAX_LOBES>,
  lobeCount: u32,
  coat: MxCoatLayer,
  sheen: MxSheenLayer,
  fuzz: MxFuzzLayer,
  thinFilm: MxThinFilmLayer,
  emission: vec3f,
  opacity: f32,
  hasCoat: u32,
  hasSheen: u32,
  hasFuzz: u32,
  hasThinFilm: u32,
  hasEmission: u32,
  interiorSigmaA: vec3f,
  interiorSigmaS: vec3f,
  interiorG: f32,
  hasInterior: u32,
  shadingNormal: vec3f,
  hasShadingNormal: u32,
  shadingTangent: vec3f,
  hasShadingTangent: u32,
};`;function Li(e,t,n){let r=e=>{let r=t.get(e);return r!==void 0&&n.add(r),r},i=t=>e.inputs.get(t)?.source;return{s(e,t){return r(e)??gi(t)},col(e,t){return r(e)??`vec3f(${t.map(gi).join(`, `)})`},lit(e,t){let n=i(e);if(n&&(n.kind===`value`||n.kind==="default")){let e=n.value[0];return e!==void 0&&Number.isFinite(e)?e:t}return t},litRgb(e,t){let n=i(e);return n&&(n.kind===`value`||n.kind==="default")&&n.value.length>=3?[n.value[0]??0,n.value[1]??0,n.value[2]??0]:[t[0],t[1],t[2]]},dyn(t){return i(t)?.kind===`connection`||e.inputs.get(t)?.parameter!==void 0},literal(t){let n=i(t)?.kind;return e.inputs.get(t)?.parameter===void 0&&(n===void 0||n===`value`||n==="default")}}}function Ri(e){return`((${e}).x + (${e}).y + (${e}).z) / 3.0`}function L(e){return`clamp(${e}, 0.0, 1.0)`}function R(e,t,n=0){return e.lit(t,0)>n||e.dyn(t)}function zi(e,t,n){return!e.literal(t)||e.lit(t,n)>0}function Bi(e,t,n=0){return!e.literal(t)||e.lit(t,n)<1}function Vi(e,t){return e===`disney_principled`||e===`simple_hair`?!0:e===`gltf_pbr`?t.literal(`alpha_mode`)&&t.lit(`alpha_mode`,0)===0?!0:t.literal(`alpha`)&&t.lit(`alpha`,1)>=1&&t.literal(`alpha_cutoff`)&&t.lit(`alpha_cutoff`,.5)<=1:e===`UsdPreviewSurface`?t.literal(`opacityThreshold`)&&t.lit(`opacityThreshold`,0)<=0||t.literal(`opacity`)&&t.lit(`opacity`,1)>=1&&t.literal(`opacityThreshold`)&&t.lit(`opacityThreshold`,0)<=1:e===`open_pbr_surface`?t.literal(`geometry_opacity`)&&t.lit(`geometry_opacity`,1)>=1:t.literal(`opacity`)&&t.litRgb(`opacity`,[1,1,1]).every(e=>e>=1)}function Hi(e){let t=e.s(`specular_roughness`,.2),n=e.s(`diffuse_roughness`,0),r=e.s(`specular_anisotropy`,0),i=e.s(`specular_rotation`,0),a=e.s(`specular_IOR`,1.5),o=`clamp(${e.col(`base_color`,[1,1,1])}, vec3f(0.0), vec3f(1.0))`,s=e.col(`specular_color`,[1,1,1]),c=e.col(`transmission_color`,[1,1,1]),l=e.col(`subsurface_color`,[1,1,1]),u={locals:[`  let mx_base = ${e.s(`base`,1)};`,`  let mx_metal = ${L(e.s(`metalness`,0))};`,`  let mx_trans = ${L(e.s(`transmission`,0))};`,`  let mx_spec = ${L(e.s(`specular`,1))};`,`  let mx_sss = ${L(e.s(`subsurface`,0))};`,`  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`],lobes:[{kind:`conductor`,weight:`mx_metal`,color:o,roughness:t,anisotropy:r,rotation:i,active:zi(e,`metalness`,0)},{kind:`dielectric_transmission`,weight:`((1.0 - mx_metal) * mx_trans)`,color:c,roughness:t,ior:a,dispersion:`select(0.0, 20.0 / max(${e.s(`transmission_dispersion`,0)}, 1e-6), ${e.s(`transmission_dispersion`,0)} > 0.0)`,active:zi(e,`transmission`,0)},{kind:`dielectric_reflection`,weight:`(mx_diel * mx_spec)`,color:s,roughness:t,ior:a,anisotropy:r,rotation:i,active:zi(e,`specular`,1)},{kind:`burley_diffuse`,weight:`(mx_diel * mx_base)`,color:o,roughness:n,active:zi(e,`base`,1)},{kind:`subsurface`,weight:`(mx_diel * mx_sss)`,color:l,active:zi(e,`subsurface`,0)}],opacity:Ri(e.col(`opacity`,[1,1,1])),transmission:R(e,`transmission`),dispersion:R(e,`transmission_dispersion`)};return R(e,`coat`)&&(u.coat={weight:L(e.s(`coat`,0)),color:e.col(`coat_color`,[1,1,1]),roughness:e.s(`coat_roughness`,.1),ior:e.s(`coat_IOR`,1.5)}),R(e,`sheen`)&&(u.sheen={weight:L(e.s(`sheen`,0)),color:e.col(`sheen_color`,[1,1,1]),roughness:e.s(`sheen_roughness`,.3)}),R(e,`thin_film_thickness`)&&(u.thinFilm={weight:`1.0`,thickness:e.s(`thin_film_thickness`,0),ior:e.s(`thin_film_IOR`,1.5)}),R(e,`emission`)&&(u.emission=`(${e.col(`emission_color`,[1,1,1])} * ${e.s(`emission`,0)})`),u}function Ui(e){let t=e.s(`specular_roughness`,.3),n=e.s(`base_diffuse_roughness`,0),r=e.s(`specular_roughness_anisotropy`,0),i=e.s(`specular_ior`,1.5),a=e.col(`base_color`,[.8,.8,.8]),o=e.col(`specular_color`,[1,1,1]),s=e.col(`transmission_color`,[1,1,1]),c=e.col(`subsurface_color`,[.8,.8,.8]),l=e.lit(`geometry_thin_walled`,0)>.5,u=[`  let mx_baseW = ${L(e.s(`base_weight`,1))};`,`  let mx_metal = ${L(e.s(`base_metalness`,0))};`,`  let mx_specW = ${L(e.s(`specular_weight`,1))};`,`  let mx_trans = ${L(e.s(`transmission_weight`,0))};`,`  let mx_sss = ${L(e.s(`subsurface_weight`,0))};`,`  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`],d=l?`((1.0 - mx_metal) * mx_specW)`:`(mx_diel * mx_specW)`,f={kind:`dielectric_transmission`,weight:`((1.0 - mx_metal) * mx_trans)`,color:s,roughness:t,ior:i,dispersion:`(max(${e.s(`transmission_dispersion_scale`,0)}, 0.0) * 20.0 / max(${e.s(`transmission_dispersion_abbe_number`,20)}, 1e-6))`,active:zi(e,`transmission_weight`,0)};l&&(f.thin=`1.0`);let p={locals:u,lobes:[{kind:`conductor`,weight:`mx_metal`,color:a,roughness:t,anisotropy:r,active:zi(e,`base_metalness`,0)},f,{kind:`dielectric_reflection`,weight:d,color:o,roughness:t,ior:i,anisotropy:r,active:zi(e,`specular_weight`,1)},{kind:`burley_diffuse`,weight:`(mx_diel * mx_baseW)`,color:a,roughness:n,active:zi(e,`base_weight`,1)},{kind:`subsurface`,weight:`(mx_diel * mx_sss)`,color:c,active:zi(e,`subsurface_weight`,0)}],opacity:e.s(`geometry_opacity`,1),transmission:R(e,`transmission_weight`),dispersion:!l&&R(e,`transmission_dispersion_scale`)};return R(e,`coat_weight`)&&(p.coat={weight:L(e.s(`coat_weight`,0)),color:e.col(`coat_color`,[1,1,1]),roughness:e.s(`coat_roughness`,0),ior:e.s(`coat_ior`,1.6)}),R(e,`fuzz_weight`)&&(p.fuzz={weight:L(e.s(`fuzz_weight`,0)),color:e.col(`fuzz_color`,[1,1,1]),roughness:e.s(`fuzz_roughness`,.5)}),R(e,`thin_film_weight`)&&(p.thinFilm={weight:L(e.s(`thin_film_weight`,0)),thickness:`(${e.s(`thin_film_thickness`,.5)} * 1000.0)`,ior:e.s(`thin_film_ior`,1.4)}),R(e,`emission_luminance`)&&(p.emission=`(${e.col(`emission_color`,[1,1,1])} * ${e.s(`emission_luminance`,0)})`),p}function Wi(e){let t=e.s(`roughness`,1),n=e.s(`anisotropy_strength`,0),r=e.s(`anisotropy_rotation`,0),i=e.s(`ior`,1.5),a=e.col(`base_color`,[1,1,1]),o=e.col(`specular_color`,[1,1,1]),s=[`  let mx_metal = ${L(e.s(`metallic`,1))};`,`  let mx_trans = ${L(e.s(`transmission`,0))};`,`  let mx_spec = ${L(e.s(`specular`,1))};`,`  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`],c=[{kind:`conductor`,weight:`mx_metal`,color:a,roughness:t,anisotropy:n,rotation:r,active:zi(e,`metallic`,1)},{kind:`dielectric_transmission`,weight:`((1.0 - mx_metal) * mx_trans)`,color:a,roughness:t,ior:i,dispersion:`max(${e.s(`dispersion`,0)}, 0.0)`,active:zi(e,`transmission`,0)},{kind:`dielectric_reflection`,weight:`(mx_diel * mx_spec)`,color:o,roughness:t,ior:i,anisotropy:n,rotation:r,active:zi(e,`specular`,1)},{kind:`burley_diffuse`,weight:`mx_diel`,color:a,roughness:t}],l=L(e.s(`alpha`,1)),u=e.s(`alpha_mode`,0),d={locals:s,lobes:c,opacity:`select(select(${l}, select(0.0, 1.0, ${l} >= ${e.s(`alpha_cutoff`,.5)}), ${u} == 1), 1.0, ${u} == 0)`,transmission:R(e,`transmission`),dispersion:R(e,`dispersion`)};R(e,`clearcoat`)&&(d.coat={weight:L(e.s(`clearcoat`,0)),color:`vec3f(1.0)`,roughness:e.s(`clearcoat_roughness`,0),ior:`1.5`});let f=e.litRgb(`sheen_color`,[0,0,0]);if(Math.max(f[0],f[1],f[2])>0||e.dyn(`sheen_color`)){let t=e.col(`sheen_color`,[0,0,0]);d.sheen={weight:`max(max((${t}).x, (${t}).y), (${t}).z)`,color:t,roughness:e.s(`sheen_roughness`,0)}}R(e,`iridescence`)&&(d.thinFilm={weight:L(e.s(`iridescence`,0)),thickness:e.s(`iridescence_thickness`,100),ior:`1.3`});let p=e.litRgb(`emissive`,[0,0,0]);return(p[0]>0||p[1]>0||p[2]>0||e.dyn(`emissive`))&&(d.emission=e.col(`emissive`,[0,0,0])),d}function Gi(e){let t=e.s(`roughness`,.5),n=e.s(`ior`,1.5),r=e.col(`diffuseColor`,[.18,.18,.18]),i=e.lit(`useSpecularWorkflow`,0)>=.5?e.col(`specularColor`,[0,0,0]):`vec3f(1.0)`,a=(e.dyn(`opacity`)||e.lit(`opacity`,1)<1)&&(e.dyn(`opacityThreshold`)||e.lit(`opacityThreshold`,0)<=0),o={locals:[`  let mx_metal = ${L(e.s(`metallic`,0))};`,`  let mx_diel = 1.0 - mx_metal;`,`  let mx_opacity = ${L(e.s(`opacity`,1))};`,`  let mx_threshold = ${e.s(`opacityThreshold`,0)};`,`  let mx_diffuseShare = select(mx_opacity, 1.0, mx_threshold > 0.0);`],lobes:[{kind:`conductor`,weight:`mx_metal`,color:r,roughness:t,active:zi(e,`metallic`,0)},{kind:`dielectric_reflection`,weight:`(mx_diel * mx_diffuseShare)`,color:i,roughness:t,ior:n},{kind:`dielectric_transmission`,weight:`(mx_diel * (1.0 - mx_diffuseShare))`,color:`vec3f(1.0)`,roughness:t,ior:n,active:a},{kind:`burley_diffuse`,weight:`(mx_diel * mx_diffuseShare)`,color:r,roughness:t}],opacity:`select(1.0, 0.0, mx_threshold > 0.0 && mx_opacity < mx_threshold)`,transmission:a};R(e,`clearcoat`)&&(o.coat={weight:L(e.s(`clearcoat`,0)),color:`vec3f(1.0)`,roughness:e.s(`clearcoatRoughness`,.01),ior:`1.5`});let s=e.litRgb(`emissiveColor`,[0,0,0]);return(s[0]>0||s[1]>0||s[2]>0||e.dyn(`emissiveColor`))&&(o.emission=e.col(`emissiveColor`,[0,0,0])),o}function Ki(e){let t=e.s(`roughness`,.5),n=e.s(`anisotropic`,0),r=e.s(`ior`,1.5),i=e.col(`baseColor`,[.16,.16,.16]),a=`mix(vec3f(1.0), ${i}, ${L(e.s(`specularTint`,0))})`,o=[`  let mx_metal = ${L(e.s(`metallic`,0))};`,`  let mx_trans = ${L(e.s(`specTrans`,0))};`,`  let mx_spec = ${L(e.s(`specular`,.5))};`,`  let mx_sss = ${L(e.s(`subsurface`,0))};`,`  let mx_diel = (1.0 - mx_metal) * (1.0 - mx_trans);`],s=Bi(e,`metallic`)&&Bi(e,`specTrans`),c={locals:o,lobes:[{kind:`conductor`,weight:`mx_metal`,color:i,roughness:t,anisotropy:n,active:zi(e,`metallic`,0)},{kind:`dielectric_transmission`,weight:`((1.0 - mx_metal) * mx_trans)`,color:i,roughness:t,ior:r,active:Bi(e,`metallic`)&&zi(e,`specTrans`,0)},{kind:`dielectric_reflection`,weight:`(mx_diel * mx_spec)`,color:a,roughness:t,ior:r,anisotropy:n,active:s&&zi(e,`specular`,.5)},{kind:`burley_diffuse`,weight:`mx_diel`,color:i,roughness:t,active:s},{kind:`subsurface`,weight:`(mx_diel * mx_sss)`,color:i,active:s&&zi(e,`subsurface`,0)}],opacity:`1.0`,transmission:R(e,`specTrans`),dispersion:!1};return R(e,`sheen`)&&(c.sheen={weight:L(e.s(`sheen`,0)),color:`mix(vec3f(1.0), ${i}, ${L(e.s(`sheenTint`,.5))})`,roughness:`0.3`}),R(e,`clearcoat`)&&(c.coat={weight:L(e.s(`clearcoat`,0)),color:`vec3f(1.0)`,roughness:`(1.0 - ${L(e.s(`clearcoatGloss`,1))})`,ior:`1.5`}),c}function qi(e,t){switch(e){case`simple_hair`:return{locals:[`  let mx_hair_sigma = mix(mx_hair_absorption_color(${t.col(`baseColor`,[1,1,1])}, ${t.s(`azimuthalRoughness`,.1)}), mx_hair_absorption_melanin(${t.s(`melaninConcentration`,.5)}, ${t.s(`melaninRedness`,.5)}), ${L(t.s(`melaninMix`,1))});`],lobes:[{kind:`chiang_hair`,weight:`1.0`,color:t.col(`tint_R`,[1,1,1]),color90:t.col(`tint_TT`,[1,1,1]),hairTintTRT:t.col(`tint_TRT`,[1,1,1]),extinction:`mx_hair_sigma`,roughness:t.s(`longitudinalRoughness`,.1),anisotropy:t.s(`azimuthalRoughness`,.1),rotation:t.s(`cuticleAngle`,.5),ior:t.s(`ior`,1.55)}],opacity:`1.0`,transmission:!1};case`standard_surface`:return Hi(t);case`open_pbr_surface`:return Ui(t);case`gltf_pbr`:return Wi(t);case`UsdPreviewSurface`:return Gi(t);case`disney_principled`:return Ki(t)}}function Ji(e,t){return`  c.lobes[${e}] = MxBsdfLobe(${[Pi[t.kind],t.weight,t.color,t.color90??t.color,t.roughness??`0.0`,t.anisotropy??`0.0`,t.rotation??`0.0`,t.ior??`1.5`,t.extinction??`vec3f(0.0)`,t.thin??`0.0`,t.dispersion??`0.0`,t.hairTintTRT??`vec3f(1.0)`].join(`, `)});`}function Yi(e,t,n,r,i=``,a=!1,o=!1){let s=new Ge,c=wr(e,t,s,r),l=new Set,u=Li(t,c.inputs,l),d=qi(t.family,u),f=o?d.lobes.filter(e=>e.active!==!1):[...d.lobes];d.sheen&&f.push({kind:`sheen`,...d.sheen});let p=t.family===`open_pbr_surface`?`geometry_normal`:`normal`,m=t.inputs.get(p)?.source,h=t.family!==`UsdPreviewSurface`&&(m?.kind===`connection`||m?.kind===`value`)?c.inputs.get(p):void 0;h!==void 0&&l.add(h);for(let e of l)s.output({name:e,type:N,ref:e});let g=Di(s.build(),i,a),_=[`  c.lobeCount = ${f.length}u;`];t.family===`simple_hair`&&_.push(`  c.hasShadingTangent = 1u;`,`  c.shadingTangent = vary.tangent;`),h!==void 0&&_.push(`  c.hasShadingNormal = 1u;`,`  c.shadingNormal = ${h};`),f.forEach((e,t)=>_.push(Ji(t,e))),d.coat&&_.push(`  c.hasCoat = 1u;`,`  c.coat = MxCoatLayer(${d.coat.weight}, ${d.coat.color}, ${d.coat.roughness}, ${d.coat.ior});`),d.sheen&&_.push(`  c.hasSheen = 1u;`,`  c.sheen = MxSheenLayer(${d.sheen.weight}, ${d.sheen.color}, ${d.sheen.roughness});`),d.fuzz&&_.push(`  c.hasFuzz = 1u;`,`  c.fuzz = MxFuzzLayer(${d.fuzz.weight}, ${d.fuzz.color}, ${d.fuzz.roughness});`),d.thinFilm&&_.push(`  c.hasThinFilm = 1u;`,`  c.thinFilm = MxThinFilmLayer(${d.thinFilm.weight}, ${d.thinFilm.thickness}, ${d.thinFilm.ior});`),d.emission&&_.push(`  c.hasEmission = 1u;`,`  c.emission = ${d.emission};`),_.push(`  c.opacity = ${d.opacity};`);let v=`fn ${n}(vary: MxVaryings) -> ${Ni} {\n${g.body.join(`
`)}\n${d.locals.join(`
`)}\n  var c: ${Ni};\n${_.join(`
`)}\n  return c;\n}`,y=d.transmission??f.some(e=>e.kind===`dielectric_transmission`),b={opaque:Vi(t.family,u),fuzz:d.fuzz!==void 0,coat:d.coat!==void 0,transmission:y,dispersion:y&&(d.dispersion??f.some(e=>e.dispersion!==void 0)),thinFilm:d.thinFilm!==void 0,lobeKinds:[...new Set(f.filter(e=>e.active!==!1).map(e=>Fi[e.kind]))]};return{fnName:n,fnCode:v,family:t.family,preludes:[...g.preludes],uniforms:g.uniforms,textures:g.textures,samplers:g.samplers,primvarFields:g.primvarFields,extraInputs:g.extraInputs,usesLighting:g.usesLighting,features:b,lobeCount:f.length}}function Xi(e,t,n=Cn){let r=Yi(e,t,Mi,n,``,!1,!0),i=[];i.push(r.preludes.join(`
`)),i.push(Ii.replace(`const MX_MAX_LOBES: u32 = 8u;`,`const MX_MAX_LOBES: u32 = ${Math.max(1,r.lobeCount)}u;`)),i.push(ci({kinds:new Set(r.features.lobeKinds),thinFilm:r.features.thinFilm})),r.uniforms.length>0&&i.push(`struct MxUniforms {\n${r.uniforms.map(e=>`  ${e.field}: ${e.wgslType},`).join(`
`)}\n};\n@group(0) @binding(0) var<uniform> u: MxUniforms;`);for(let e of r.textures)i.push(`@group(${e.group}) @binding(${e.binding}) var ${e.handle}: texture_2d<f32>;`);for(let e of r.samplers)i.push(`@group(${e.group}) @binding(${e.binding}) var ${e.handle}: sampler;`);return i.push(Ai(r.primvarFields,r.extraInputs)),i.push(r.fnCode),{code:i.join(`

`)+`
`,entryPoint:Mi,returnType:Ni,family:r.family,uniforms:r.uniforms,textures:r.textures,samplers:r.samplers,primvarFields:r.primvarFields,extraInputs:r.extraInputs,...r.usesLighting?{lighting:{group:0,binding:1}}:{},features:r.features}}function Zi(e,t,n,r=Cn){let i=Yi(e,t,`${Mi}_${n}`,r,`m${n}_`,!0,!0);return{index:n,family:i.family,fnName:i.fnName,fnCode:i.fnCode,preludes:i.preludes,uniforms:i.uniforms,textures:i.textures,samplers:i.samplers,primvarFields:i.primvarFields,extraInputs:i.extraInputs,lobeCount:i.lobeCount,features:i.features}}function Qi(e){let t=[],n=new Map,r=[],i=e.flatMap(e=>e.textures);for(let e of i)if(e.fileRef!==void 0){let i=n.get(e.fileRef);i===void 0&&(i=t.length,t.push(e.fileRef),n.set(e.fileRef,i)),r.push(i)}else r.push(t.length),t.push(void 0);return{textures:i.map((e,t)=>({name:e.name,handle:e.handle,group:1,binding:t,...e.colorSpace===void 0?{}:{colorSpace:e.colorSpace}})),samplers:e.flatMap(e=>e.samplers).map((e,t)=>({...e,group:2,binding:t})),images:t,textureImage:r}}var $i=`mx_eval_material`,ea=`mx_material_closure`;function ta(e){let t=new Map;for(let n of e)t.has(n.field)||t.set(n.field,n);return[...t.values()]}function na(e){let t=new Map;for(let n of e)for(let[e,r]of n)t.has(e)||t.set(e,r);return t}function ra(e){let t=[...e].sort((e,t)=>e.materialIndex-t.materialIndex).map(e=>Zi(e.graph,e.surface,e.materialIndex)),n=[...new Set(t.flatMap(e=>e.preludes))],r=Qi(t),i=r.textures,a=r.samplers,o=ta(t.flatMap(e=>e.uniforms)),s=na(t.map(e=>e.primvarFields)),c=na(t.map(e=>e.extraInputs)),l=new Map,u=new Map,d=new Map;for(let e of t){let t=e.uniforms.length===0&&e.textures.length===0&&e.samplers.length===0,n=e.fnCode.replace(`fn ${e.fnName}(`,`fn surface(`),r=t?l.get(n):void 0;u.set(e.index,r?.fnName??e.fnName),r||(d.set(e.fnName,e),t&&l.set(n,e))}let f=[...t.map(e=>`    case ${e.index}u: { return ${u.get(e.index)}(vary); }`),`    default: { return ${ea}(matId); }`].join(`
`),p=[...d.values()].map(e=>e.fnCode).join(`

`);return{variants:t,dispatcherWgsl:`${p?p+`

`:``}fn ${$i}(matId: u32, vary: MxVaryings) -> LayeredClosure {\n  switch matId {\n${f}\n  }\n}`,preludes:n,textures:i,samplers:a,textureRegistry:r,uniforms:o,primvarFields:s,extraInputs:c}}function ia(e,t){let n=e.split(``),r=0,i=!1;for(let t=0;t<n.length;t++){let a=e.slice(t,t+2);i?e[t]===`
`?i=!1:n[t]=` `:r>0?a===`/*`?(r++,n[t]=n[t+1]=` `,t++):a===`*/`?(r--,n[t]=n[t+1]=` `,t++):e[t]!==`
`&&(n[t]=` `):a===`//`?(i=!0,n[t]=n[t+1]=` `,t++):a===`/*`&&(r=1,n[t]=n[t+1]=` `,t++)}if(r)throw Error(`Unterminated WGSL block comment.`);let a=n.join(``),o=new Map,s=new Set,c=/\bfn\s+([A-Za-z_]\w*)\s*\(/g;for(let e=c.exec(a);e;e=c.exec(a)){let t=e.index,n=a.indexOf(`{`,c.lastIndex);if(n<0)throw Error(`Missing WGSL function body: ${e[1]}`);let r=1,i=n+1;for(;i<a.length&&r>0;i++)a[i]===`{`?r++:a[i]===`}`&&r--;if(r)throw Error(`Unterminated WGSL function: ${e[1]}`);let l=e[1],u=Math.max(a.lastIndexOf(`;`,t),a.lastIndexOf(`}`,t));if(a.slice(u+1,t).includes(`@`)&&s.add(l),o.has(l))throw Error(`Duplicate WGSL function: ${l}`);o.set(l,{start:t,end:i,identifiers:a.slice(t,i).match(/\b[A-Za-z_]\w*\b/g)??[]}),c.lastIndex=i}let l=a.split(``);for(let{start:e,end:t}of o.values())l.fill(` `,e,t);let u=[...t,...s,...l.join(``).match(/\b[A-Za-z_]\w*\b/g)??[]];for(let e of t)if(!o.has(e))throw Error(`Unknown WGSL entry point: ${e}`);let d=new Set;for(;u.length;){let e=u.pop(),t=o.get(e);t&&!d.has(e)&&(d.add(e),u.push(...t.identifiers))}let f=0,p=[];for(let[t,{start:n,end:r}]of o)d.has(t)||(p.push(e.slice(f,n)),f=r);return p.push(e.slice(f)),p.join(``)}var aa=`mx_path_trace`;function oa(e,t){let n=new Set,r=!1,i=!1,a=new Set(e.variants.map(e=>e.index));for(let t of e.variants){if(!t.features)return{kinds:new Set([0,1,2,3,4,5,6,7,8,9]),thinFilm:!0};t.features.lobeKinds.forEach(e=>n.add(e)),r||=t.features.thinFilm,i||=t.features.fuzz!==!1}for(let e=0,o=0;e<t.length;e+=245,o++)if(!a.has(o)){r||=t[e+5]!==0,i||=t[e+4]!==0;for(let r=0;r<t[e];r++){let i=e+29+r*27;t[i+1]>0&&n.add(t[i])}}return{kinds:n,thinFilm:r,fuzz:i}}function sa(e,t){if(e.variants.some(e=>e.features?.opaque!==!0))return!1;let n=new Set(e.variants.map(e=>e.index));for(let e=0,r=0;e<t.length;e+=245,r++)if(!n.has(r)&&t[e+1]!==1)return!1;return!0}function ca(e,t,n){let r=n%4,i=Math.floor(n/4),a=Math.floor(r*e/4),o=Math.floor(i*t/4);return{x:a,y:o,width:Math.floor((r+1)*e/4)-a,height:Math.floor((i+1)*t/4)-o}}function la(e,t,n){return`
struct Uniforms {
  invViewProj : mat4x4<f32>,
  eye : vec4<f32>,
  lightDir : vec4<f32>,
  lightColor : vec4<f32>,
  env : vec4<f32>, // xyz = skyColor, w = skyPower (dome intensity; > 0 selects textured path)
  frame : vec4<f32>, // x = frameIndex, y = samplesPerFrame, z = width, w = height
  envExtra : vec4<f32>, // x = envResX, y = envResY, z = envTotalSum, w = hasEnvCdf
  sh : array<vec4<f32>, 9>, // 9 RGB SH9 irradiance coefficients (.xyz), w unused
  tile : vec4<f32>,
  envTexture : vec4<f32>, // x = half-float texture radiance scale
  backgroundInvViewProj : mat4x4<f32>,
  transport : vec4<f32>, // depth, roulette depth, analytic light count, converted camera
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> nodes : array<f32>;
@group(0) @binding(2) var<storage, read> tris : array<f32>;
@group(0) @binding(3) var<storage, read> triOrder : array<u32>;
@group(0) @binding(4) var<storage, read> materials : array<f32>;
@group(0) @binding(5) var<storage, read_write> accum : array<vec4<f32>>;
${e?`
@group(0) @binding(6) var<storage, read> triUv : array<f32>;
@group(0) @binding(7) var<storage, read> matLayer : array<i32>;
@group(0) @binding(8) var bakedTex : texture_2d_array<f32>;
@group(0) @binding(9) var bakedSampler : sampler;
const UV_STRIDE : u32 = 6u;
`:t?`
@group(0) @binding(6) var<storage, read> triUv : array<f32>;
@group(0) @binding(7) var<storage, read> triTangent : array<f32>;
const UV_STRIDE : u32 = 6u;
const TAN_STRIDE : u32 = 12u;
`:``}
const PI : f32 = 3.14159265358979;
const NODE_STRIDE : u32 = 12u;
const TRI_STRIDE : u32 = 24u;
const RAY_EPS : f32 = 1.0e-4;
${n?ua():``}`}function ua(){return`
@group(3) @binding(0) var envTex : texture_2d<f32>;
@group(3) @binding(1) var envSampler : sampler;
@group(3) @binding(2) var<storage, read> envCdf : array<f32>;
fn env_dir_to_uv(d : vec3<f32>) -> vec2<f32> {
  let n = normalize(d);
  let u = atan2(n.z, n.x) * (0.5 / PI) + 0.5;
  let v = acos(clamp(n.y, -1.0, 1.0)) / PI;
  return vec2<f32>(u, v);
}
fn env_radiance(d : vec3<f32>) -> vec3<f32> {
  if (U.env.w > 0.0) {
    let c = textureSampleLevel(envTex, envSampler, env_dir_to_uv(d), 0.0).xyz;
    return c * U.envTexture.x * U.env.xyz * U.env.w;
  }
  return U.env.xyz;
}
// Equirectangular latlong <-> direction (raw scanline order, matching the env
// texture and the flat row-major luminance CDF). env_map_uv_to_dir is the exact
// inverse of env_dir_to_uv used for CDF importance sampling.
fn env_map_uv_to_dir(uv : vec2<f32>) -> vec3<f32> {
  let phi = uv.x * (2.0 * PI);
  let theta = uv.y * PI;
  let s = sin(theta);
  return vec3<f32>(-s * cos(phi), cos(theta), -s * sin(phi));
}
fn env_map_luminance(c : vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.212671, 0.715160, 0.072169));
}
fn env_cdf_at(x : i32, y : i32) -> f32 {
  return envCdf[y * i32(U.envExtra.x) + x];
}
// Two-stage binary search over the single monotonic flat CDF (GLSL-PathTracer-JS
// style): first the row-end checkpoints (column W-1) for the row, then within it.
fn env_map_binary_search(value : f32) -> vec2<f32> {
  let resX = i32(U.envExtra.x);
  let resY = i32(U.envExtra.y);
  var lower = 0;
  var upper = resY - 1;
  loop {
    if (lower >= upper) { break; }
    let mid = (lower + upper) / 2;
    if (value < env_cdf_at(resX - 1, mid)) { upper = mid; } else { lower = mid + 1; }
  }
  let y = clamp(lower, 0, resY - 1);
  lower = 0;
  upper = resX - 1;
  loop {
    if (lower >= upper) { break; }
    let mid = (lower + upper) / 2;
    if (value < env_cdf_at(mid, y)) { upper = mid; } else { lower = mid + 1; }
  }
  let x = clamp(lower, 0, resX - 1);
  return vec2<f32>(f32(x), f32(y)) / vec2<f32>(U.envExtra.x, U.envExtra.y);
}
// Solid-angle PDF of an env sample at uv with pixel radiance 'color'.
fn env_map_pdf_from_uv(uv : vec2<f32>, color : vec3<f32>) -> f32 {
  let theta = uv.y * PI;
  let s = sin(theta);
  if (s <= 0.0) { return 0.0; }
  let p = env_map_luminance(color) / max(U.envExtra.z, 1.0e-6);
  return (p * U.envExtra.x * U.envExtra.y) / (2.0 * PI * PI * s);
}
// Solid-angle PDF the env-importance strategy would assign to direction d (for MIS).
fn sky_pdf(d : vec3<f32>) -> f32 {
  let uv = env_dir_to_uv(normalize(d));
  let color = textureSampleLevel(envTex, envSampler, uv, 0.0).xyz * U.envTexture.x;
  return env_map_pdf_from_uv(uv, color);
}
// Diffuse irradiance E(n) from the uploaded SH9 radiance coefficients (cosine-lobe
// convolution A_l; basis matches projectIrradianceSH / evalIrradianceSH on the CPU).
// Returns radiance to be multiplied by albedo/PI and the dome tint/intensity.
fn mx_sh_irradiance(n : vec3<f32>) -> vec3<f32> {
  let A0 = 3.14159265358979;
  let A1 = 2.09439510239320; // 2*PI/3
  let A2 = 0.78539816339745; // PI/4
  let x = n.x; let y = n.y; let z = n.z;
  var e = U.sh[0].xyz * (A0 * 0.282095);
  e = e + U.sh[1].xyz * (A1 * 0.488603 * y);
  e = e + U.sh[2].xyz * (A1 * 0.488603 * z);
  e = e + U.sh[3].xyz * (A1 * 0.488603 * x);
  e = e + U.sh[4].xyz * (A2 * 1.092548 * x * y);
  e = e + U.sh[5].xyz * (A2 * 1.092548 * y * z);
  e = e + U.sh[6].xyz * (A2 * 0.315392 * (3.0 * z * z - 1.0));
  e = e + U.sh[7].xyz * (A2 * 1.092548 * x * z);
  e = e + U.sh[8].xyz * (A2 * 0.546274 * (x * x - y * y));
  return max(e, vec3<f32>(0.0));
}
`}function da(){return`
// PCG32 hash -> uniform f32 in [0,1); mirrors createPcg32 in integrator.ts.
fn pcg_hash(v : u32) -> u32 {
  var state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn rng_next(state : ptr<function, u32>) -> f32 {
  *state = pcg_hash(*state);
  return f32(*state) * (1.0 / 4294967296.0);
}
`}function fa(){return ai}var pa=`struct MxMedium {
  sigmaA: vec3f,
  sigmaS: vec3f,
  g: f32,
};
struct MxMediumSample {
  scattered: bool,
  t: f32,
  weight: vec3f,
};
fn mx_pick3(v : vec3f, ch : u32) -> f32 {
  if (ch == 0u) { return v.x; }
  if (ch == 1u) { return v.y; }
  return v.z;
}
fn mx_absorbing_medium(attenColor : vec3f, attenDist : f32) -> MxMedium {
  var m : MxMedium;
  if (attenDist > 0.0) {
    let c = clamp(attenColor, vec3f(1.0e-6), vec3f(1.0));
    m.sigmaA = -log(c) / attenDist;
  }
  return m;
}
fn mx_single_scatter_albedo(a : vec3f) -> vec3f {
  let c = clamp(a, vec3f(0.0), vec3f(1.0));
  return vec3f(1.0) - exp(-5.09406 * c + 2.61188 * c * c - 4.31805 * c * c * c);
}
fn mx_extinction_from_mfp(mfp : vec3f, albedo : vec3f) -> vec3f {
  let d = albedo - vec3f(0.8);
  let s = vec3f(1.9) - albedo + 3.5 * d * d;
  let dd = mfp * s;
  return select(vec3f(0.0), vec3f(1.0) / dd, dd > vec3f(0.0));
}
fn mx_subsurface_medium(albedo : vec3f, mfp : vec3f, g : f32) -> MxMedium {
  let alpha = mx_single_scatter_albedo(albedo);
  let sigmaT = mx_extinction_from_mfp(mfp, albedo);
  var m : MxMedium;
  m.sigmaS = alpha * sigmaT;
  m.sigmaA = (vec3f(1.0) - alpha) * sigmaT;
  m.g = g;
  return m;
}
// Hero-wavelength free-flight sampler: picks a channel, samples a collision
// distance from its extinction, and returns the MIS-balanced throughput for the
// scatter or the surface-reaching branch (matches sampleHomogeneous in media.ts).
fn mx_sample_homogeneous(m : MxMedium, tMax : f32, state : ptr<function, u32>) -> MxMediumSample {
  let sigmaT = m.sigmaA + m.sigmaS;
  let ch = min(2u, u32(floor(rng_next(state) * 3.0)));
  let st = mx_pick3(sigmaT, ch);
  var t = 1.0e30;
  if (st > 0.0) { t = -log(1.0 - rng_next(state)) / st; }
  var samp : MxMediumSample;
  samp.scattered = t < tMax;
  let dist = select(tMax, t, samp.scattered);
  samp.t = dist;
  let tr = exp(-sigmaT * max(dist, 0.0));
  if (samp.scattered) {
    let density = dot(sigmaT * tr, vec3f(1.0)) / 3.0;
    samp.weight = select(vec3f(0.0), (tr * m.sigmaS) / density, density > 0.0);
  } else {
    let density = dot(tr, vec3f(1.0)) / 3.0;
    samp.weight = select(vec3f(0.0), tr / density, density > 0.0);
  }
  return samp;
}`,ma=`fn mx_sample_hg(wo : vec3f, g : f32, u1 : f32, u2 : f32) -> vec3f {
  let w = normalize(wo);
  var cosTheta : f32;
  if (abs(g) < 1.0e-3) {
    cosTheta = 1.0 - 2.0 * u1;
  } else {
    let sqr = (1.0 - g * g) / (1.0 + g - 2.0 * g * u1);
    cosTheta = -(1.0 + g * g - sqr * sqr) / (2.0 * g);
  }
  let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
  let phi = 2.0 * PI * u2;
  let local = vec3f(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
  return basis(w) * local;
}`;function ha(e,t,n){let r=e?`
// Apply a baked albedo + roughness texel onto the reconstructed closure. The
// albedo rides the colour-carrying lobes (diffuse, conductor, translucent); the
// achromatic dielectric specular keeps its white tint. Roughness updates every
// lobe, matching the former seven-parameter baseColor/roughness override.
fn mx_apply_baked(c : ptr<function, LayeredClosure>, albedo : vec3<f32>, rough : f32) {
  for (var i : u32 = 0u; i < (*c).lobeCount; i = i + 1u) {
    let k = (*c).lobes[i].kind;
    if (k != MX_LOBE_DIELECTRIC_REFLECTION && k != MX_LOBE_SHEEN) {
      (*c).lobes[i].color = albedo;
    }
    (*c).lobes[i].roughness = rough;
  }
}`:``;return[Ii.replace(`const MX_MAX_LOBES: u32 = 8u;`,`const MX_MAX_LOBES: u32 = ${t}u;`),ci(n),pa,Vr(),`
// Branchless orthonormal basis (Duff et al. 2017) around a unit normal; matches
// shadingFrame in bsdf.ts. Columns (t, bt, n) map local +Z to the world normal.
fn basis(n : vec3<f32>) -> mat3x3<f32> {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  let t = vec3<f32>(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
  let bt = vec3<f32>(b, s + n.y * n.y * a, -n.y);
  return mat3x3<f32>(t, bt, n);
}`,ma,r].join(`
`)}function ga(e){let t=[];for(let[n]of e.primvarFields)n===`st`&&t.push(`  vary.v_st = uv;`);return[Ai(e.primvarFields,e.extraInputs),`
fn mx_tri_uv(tri : u32, slot : u32) -> vec2<f32> {
  let b = tri * UV_STRIDE + slot * 2u;
  return vec2<f32>(triUv[b], triUv[b + 1u]);
}

fn mx_hit_uv(h : Hit) -> vec2<f32> {
  let w = 1.0 - h.u - h.v;
  return mx_tri_uv(h.tri, 0u) * w + mx_tri_uv(h.tri, 1u) * h.u + mx_tri_uv(h.tri, 2u) * h.v;
}

fn mx_tri_tangent(tri : u32, slot : u32) -> vec4<f32> {
  let b = tri * TAN_STRIDE + slot * 4u;
  return vec4<f32>(triTangent[b], triTangent[b + 1u], triTangent[b + 2u], triTangent[b + 3u]);
}

// Barycentric-interpolated per-triangle tangent; zero when no tangent stream was
// packed (empty buffer), so the caller keeps the branchless basis tangent.
fn mx_hit_tangent(h : Hit) -> vec4<f32> {
  if (arrayLength(&triTangent) < TAN_STRIDE) { return vec4<f32>(0.0); }
  let w = 1.0 - h.u - h.v;
  return mx_tri_tangent(h.tri, 0u) * w + mx_tri_tangent(h.tri, 1u) * h.u + mx_tri_tangent(h.tri, 2u) * h.v;
}

// Build the MxVaryings the layered-surface variants consume from a hit: the
// interpolated position/normal come from the integrator, the texcoord from the
// per-triangle UVs, and the tangent frame from the authored per-triangle
// tangents when present, else the branchless basis (anisotropy/normalmap safe,
// T057l). Primvar/extra-input fields default to zero.
fn mx_hit_varyings(h : Hit, pos : vec3<f32>, n : vec3<f32>, viewDir : vec3<f32>) -> MxVaryings {
  var vary : MxVaryings;
  let uv = mx_hit_uv(h);
  let f = basis(n);
  let tangentWithSign = mx_hit_tangent(h);
  let tRaw = tangentWithSign.xyz;
  let projectedTangent = tRaw - n * dot(n, tRaw);
  let hasT = dot(projectedTangent, projectedTangent) > 1.0e-10;
  let tang = select(f[0], normalize(projectedTangent), hasT);
  vary.position = pos;
  vary.normal = n;
  vary.tangent = tang;
  vary.bitangent = select(f[1], normalize(cross(n, tang)) * select(1.0, -1.0, tangentWithSign.w < 0.0), hasT);
  vary.texcoord = uv;
  vary.viewDir = viewDir;
${t.join(`
`)}
  return vary;
}`].join(`
`)}function _a(e,t,n,r,i,a){let o=n?`env_radiance(rd)`:`U.env.xyz`,s=n?`env_radiance(wiW)`:`U.env.xyz`,c=t?`    let vary = mx_hit_varyings(hit, pos, n, normalize(-rd));
    var c = ${$i}(tri_material(hit.tri), vary);`:`    var c = mx_material_closure(tri_material(hit.tri));${e?`
    let layer = matLayer[tri_material(hit.tri)];
    if (layer >= 0) {
      let uv = surface_hit_uv(hit);
      let tx = textureSampleLevel(bakedTex, bakedSampler, uv, layer, 0.0);
      mx_apply_baked(&c, tx.rgb, clamp(tx.a, 0.03, 1.0));
    }`:``}`;return`
fn power_heuristic(nf : f32, fp : f32, ng : f32, gp : f32) -> f32 {
  let f = nf * fp;
  let g = ng * gp;
  let f2 = f * f;
  let g2 = g * g;
  if (f2 + g2 <= 0.0) { return 0.0; }
  return f2 / (f2 + g2);
}

fn surface_hit_normal(h : Hit) -> vec3<f32> {
  let w = 1.0 - h.u - h.v;
  let n = tri_normal(h.tri, 0u) * w + tri_normal(h.tri, 1u) * h.u + tri_normal(h.tri, 2u) * h.v;
  return normalize(n);
}
${e?`
fn tri_uv(tri : u32, slot : u32) -> vec2<f32> {
  let b = tri * UV_STRIDE + slot * 2u;
  return vec2<f32>(triUv[b], triUv[b + 1u]);
}

fn surface_hit_uv(h : Hit) -> vec2<f32> {
  let w = 1.0 - h.u - h.v;
  return tri_uv(h.tri, 0u) * w + tri_uv(h.tri, 1u) * h.u + tri_uv(h.tri, 2u) * h.v;
}`:``}

fn mx_hit_closure(hit: Hit, pos: vec3f, rd: vec3f) -> LayeredClosure {
  let n = surface_hit_normal(hit);
${c}
  return c;
}

fn mx_visibility(origin: vec3f, direction: vec3f, distance: f32) -> f32 {
${a?`  if (mx_intersect_lights(origin, direction).distance < distance) { return 0.0; }`:``}
${i?`  return select(1.0, 0.0, traverse(origin, direction, distance, true).hitAny);`:`
  var ro = origin;
  var visibility = 1.0;
  for (var layer = 0u; layer < 128u; layer++) {
    let hit = traverse(ro, direction, distance - dot(ro - origin, direction), false);
    if (!hit.hitAny) { return visibility; }
    let pos = ro + direction * hit.t;
    let c = mx_hit_closure(hit, pos, direction);
    visibility = visibility * (1.0 - clamp(c.opacity, 0.0, 1.0));
    if (visibility <= 0.0) { return 0.0; }
    ro = pos + direction * RAY_EPS;
  }
  return 0.0;
`}
}
fn mx_alpha_visibility(origin: vec3f, direction: vec3f) -> f32 {
  return mx_visibility(origin, direction, 1.0e30);
}

fn integrate(ro0 : vec3<f32>, rd0 : vec3<f32>, backgroundDirection : vec3<f32>, state : ptr<function, u32>${r?`, coverage: ptr<function, f32>`:``}) -> vec3<f32> {
  var radiance = vec3<f32>(0.0);
  var beta = vec3<f32>(1.0);
  var ro = ro0;
  var rd = rd0;
  let toLight = normalize(-U.lightDir.xyz);
  let lightRadiance = U.lightColor.xyz * U.lightColor.w;
  let hasEnv = U.env.w > 0.0 || dot(U.env.xyz, vec3<f32>(1.0)) > 0.0;
  // MIS state carried across bounces (mirrors integratePath in integrator.ts).
  var specularBounce = true;
  var diffuseBounce = false;
  var splitFuzzEnvironment = false;
  var environmentBeta = vec3f(0.0);
  var bsdfPdf = 0.0;
  var lastN = vec3<f32>(0.0, 0.0, 1.0);
  // Active interior medium (entered through a transmissive/subsurface interface).
  var inMedium = false;
  var medium : MxMedium;
  // Select once, at the first dispersive interface, and reuse at every bounce.
  var spectralChannel = 3u;
  var cameraSegment = true;
${a?`  var analyticNee = false;`:``}

  for (var bounce = 0; bounce < 64; bounce = bounce + 1) {
${a?`    let emitter = mx_intersect_lights(ro, rd);
    let hit = traverse(ro, rd, emitter.distance, false);`:`    let hit = traverse(ro, rd, 1.0e30, false);`}
    // Free-flight sampling: when inside a medium, a collision before the surface
    // scatters off the Henyey-Greenstein phase (importance-sampled, f/pdf = 1);
    // otherwise beta carries the surface-reaching transmittance (media.ts).
    let tMax = select(${a?`emitter.distance`:`1.0e30`}, hit.t, hit.hitAny);
    if (inMedium) {
      let ms = mx_sample_homogeneous(medium, tMax, state);
      beta = beta * ms.weight;
      environmentBeta = environmentBeta * ms.weight;
      if (ms.scattered) {
        if (bounce >= i32(U.transport.x)) { break; }
        let sp = ro + rd * ms.t;
        let wiM = mx_sample_hg(-rd, medium.g, rng_next(state), rng_next(state));
        specularBounce = false;
        diffuseBounce = false;
        splitFuzzEnvironment = false;
        bsdfPdf = 0.0;
${a?`        analyticNee = false; // No analytic-light NEE is performed at a volume collision.`:``}
        ro = sp + wiM * RAY_EPS;
        rd = wiM;
        if (bounce >= i32(U.transport.y)) {
          let q = clamp(max(beta.x, max(beta.y, beta.z)), 0.0, 0.95);
          if (rng_next(state) >= q) { break; }
          beta = beta / q;
        }
        continue;
      }
    }
${a?`    if (!hit.hitAny && emitter.hit) {
${r?`      if (cameraSegment) { *coverage = 1.0; }`:``}
      var weight = 1.0;
      if (analyticNee) {
        weight = power_heuristic(1.0, bsdfPdf, 1.0, emitter.pdf);
      }
      radiance += beta * emitter.radiance * weight;
      break;
    }`:``}
    if (!hit.hitAny) {
${r?`      if (cameraSegment) { break; } // Visible dome is composited at display resolution.`:``}
      // Environment reached by BSDF sampling; MIS-weight it against the env
      // next-event strategy unless the previous bounce was specular. Only the
      // separate fuzz/SH path has an analytically integrated environment term.
      if (hasEnv) {
${n?`        if (cameraSegment && U.envTexture.y > 0.5) {
          radiance = radiance + beta * env_radiance(backgroundDirection);
        } else if (specularBounce) {
          radiance = radiance + beta * ${o};
        } else if (splitFuzzEnvironment || !diffuseBounce) {
          // Full diffuse/glossy transport, or the residual glossy response when
          // the preceding surface used the separate fuzz/SH integration.
          var envPdf = max(dot(lastN, rd), 0.0) / PI;
          if (U.envExtra.w > 0.5) { envPdf = sky_pdf(rd); }
          let w = power_heuristic(1.0, bsdfPdf, 1.0, envPdf);
          let missBeta = select(beta, environmentBeta, splitFuzzEnvironment);
          radiance = radiance + missBeta * ${o} * w;
        }`:`        if (specularBounce) {
          radiance = radiance + beta * ${o};
        } else {
          let envPdf = max(dot(lastN, rd), 0.0) / PI;
          let w = power_heuristic(1.0, bsdfPdf, 1.0, envPdf);
          radiance = radiance + beta * ${o} * w;
        }`}
      }
      break;
    }
    let pos = ro + rd * hit.t;
    let geometricNormal = surface_hit_normal(hit);
    let n = geometricNormal;
${c}
    let opacity = clamp(c.opacity, 0.0, 1.0);
    // Null events preserve throughput, MIS state and direction; alpha is
    // coverage, not coloured transmission or a refractive interface.
    if (opacity <= 0.0 || (opacity < 1.0 && rng_next(state) >= opacity)) {
      ro = pos + rd * RAY_EPS;
      continue;
    }
${r?`    if (cameraSegment) {
      *coverage = 1.0;
    }`:``}
    cameraSegment = false;
    if (mx_closure_has_dispersion(c) && spectralChannel == 3u) {
      spectralChannel = min(u32(rng_next(state) * 3.0), 2u);
      var channelWeight = vec3f(0.0);
      channelWeight[spectralChannel] = 3.0;
      beta = beta * channelWeight;
      environmentBeta = environmentBeta * channelWeight;
    }
    if (spectralChannel < 3u) { c = mx_closure_spectral_channel(c, spectralChannel); }
    let authoredNormal = mx_closure_shading_normal(c, geometricNormal);
    let shadingNormal = mx_closure_oriented_normal(c, authoredNormal, -rd);
    let frame = mx_closure_frame(c, shadingNormal, basis(shadingNormal));
    let wo = transpose(frame) * (-rd);

    // Emitters have no NEE counterpart here, so add their radiance at full weight.
    if (c.hasEmission != 0u) { radiance = radiance + beta * c.emission; }
    if (bounce >= i32(U.transport.x)) { break; }

    // A smooth dielectric (clear glass / mirror) is a near-delta BSDF: NEE can
    // only produce fireflies that the clamp removes, so skip it and treat the
    // bounce as specular (environment seen directly, at full weight).
    let specular = mx_closure_is_specular(c);

    // Next-event estimation for the distant (delta) light: a delta direction has
    // no BSDF-sampling counterpart, so its MIS weight is 1 (no power heuristic).
${a?`    if (!specular && mx_light_count() > 0u) {
      let light = mx_sample_light(pos, vec3f(rng_next(state), rng_next(state), rng_next(state)));
      if (light.pdf > 0.0) {
        let origin = pos + light.direction * RAY_EPS;
        let visibility = mx_visibility(origin, light.direction, light.distance - 2.0 * RAY_EPS);
        if (visibility > 0.0) {
          let wi = transpose(frame) * light.direction;
          let ev = mx_closure_eval(c, wo, wi);
          let weight = select(power_heuristic(1.0, light.pdf, 1.0, ev.pdf), 1.0, light.delta);
          radiance += beta * ev.value * light.radiance * (abs(wi.z) * visibility * weight / light.pdf);
        }
      }
    }`:`    if (!specular && dot(lightRadiance, lightRadiance) > 0.0) {
      let visibility = mx_alpha_visibility(pos + toLight * RAY_EPS, toLight);
      if (visibility > 0.0) {
        let wiLight = transpose(frame) * toLight;
        let ev = mx_closure_eval(c, wo, wiLight);
        let cosL = abs(dot(shadingNormal, toLight));
        radiance = radiance + beta * ev.value * lightRadiance * (cosL * visibility);
      }
    }
`}

    // Diffuse illumination must test visibility too. Retain the separate SH/LTC
    // integration only for the existing fuzz path.
    if (hasEnv && !specular) {
${n?`      let shFuzz = c.hasFuzz != 0u && c.fuzz.weight > 0.0;
      if (shFuzz) {
        let diffE = mx_sh_irradiance(shadingNormal) * U.env.xyz * U.env.w;
        radiance = radiance + beta * mx_closure_diffuse_albedo(c, wo) * (diffE / PI);
      }
      if (U.envExtra.w > 0.5) {
        // Importance-sample the HDR by its luminance CDF (unbiased, low variance).
        let uvS = env_map_binary_search(rng_next(state) * max(U.envExtra.z, 1.0e-6));
        let wiW = normalize(env_map_uv_to_dir(uvS));
        let wiLocal = transpose(frame) * wiW;
        if (wiLocal.z > 0.0 || mx_closure_has_hair(c)) {
          let colS = textureSampleLevel(envTex, envSampler, uvS, 0.0).xyz * U.envTexture.x;
          let envPdf = env_map_pdf_from_uv(uvS, colS);
          if (envPdf > 0.0) {
            let visibility = mx_alpha_visibility(pos + wiW * RAY_EPS, wiW);
            if (visibility > 0.0) {
              var ev: MxBsdfEval;
              if (shFuzz) { ev = mx_closure_specular_eval(c, wo, wiLocal); }
              else { ev = mx_closure_eval(c, wo, wiLocal); }
              let w = power_heuristic(1.0, envPdf, 1.0, ev.pdf);
              radiance = radiance + beta * ev.value * (colS * U.env.xyz * U.env.w) * (w * abs(wiLocal.z) * visibility / envPdf);
            }
          }
        }
      } else {
        let eu = vec2<f32>(rng_next(state), rng_next(state));
        let wiLocal = mx_cosine_hemisphere(eu);
        let envPdf = wiLocal.z / PI;
        if (envPdf > 0.0) {
          let wiW = frame * wiLocal;
          let visibility = mx_alpha_visibility(pos + wiW * RAY_EPS, wiW);
          if (visibility > 0.0) {
            var ev: MxBsdfEval;
            if (shFuzz) { ev = mx_closure_specular_eval(c, wo, wiLocal); }
            else { ev = mx_closure_eval(c, wo, wiLocal); }
            let w = power_heuristic(1.0, envPdf, 1.0, ev.pdf);
            radiance = radiance + beta * ev.value * ${s} * (w * wiLocal.z * visibility / envPdf);
          }
        }
      }`:`      let eu = vec2<f32>(rng_next(state), rng_next(state));
      let wiLocal = mx_cosine_hemisphere(eu);
      let envPdf = wiLocal.z / PI;
      if (envPdf > 0.0) {
        let wiW = frame * wiLocal;
        let visibility = mx_alpha_visibility(pos + wiW * RAY_EPS, wiW);
        if (visibility > 0.0) {
          let ev = mx_closure_eval(c, wo, wiLocal);
          let w = power_heuristic(1.0, envPdf, 1.0, ev.pdf);
          radiance = radiance + beta * ev.value * ${s} * (w * wiLocal.z * visibility / envPdf);
        }
      }`}
    }

    let u = vec3<f32>(rng_next(state), rng_next(state), rng_next(state));
    let bs = mx_closure_sample(c, wo, u);
    if (!bs.valid || bs.pdf <= 0.0) { break; }
    let wiWorld = frame * bs.wi;
    let cosS = abs(dot(shadingNormal, wiWorld));
    splitFuzzEnvironment = false;
${n?`    if (c.hasFuzz != 0u && c.fuzz.weight > 0.0) {
      // SH already integrated fuzz and diffuse. A mixture sample reaching the
      // dome must carry only the remaining glossy response, regardless of pick.
      splitFuzzEnvironment = true;
      let glossy = mx_closure_specular_eval(c, wo, bs.wi);
      environmentBeta = beta * glossy.value * cosS / bs.pdf;
    }`:``}
    beta = beta * bs.value * cosS / bs.pdf;
    bsdfPdf = bs.pdf;
${a?`    analyticNee = !specular && mx_light_count() > 0u;`:``}
    specularBounce = specular;
    diffuseBounce = splitFuzzEnvironment && mx_closure_sampled_is_diffuse(c, wo, u.z);
    lastN = shadingNormal;
    ro = pos + wiWorld * RAY_EPS;
    rd = wiWorld;

    // Convex-interface assumption: a transmissive bounce enters the surface's
    // interior medium (or leaves the current one), matching integratePath.
    let transmitted = (wo.z > 0.0) != (bs.wi.z > 0.0);
    if (transmitted) {
      if (inMedium) {
        inMedium = false;
      } else if (c.hasInterior != 0u) {
        medium = MxMedium(c.interiorSigmaA, c.interiorSigmaS, c.interiorG);
        inMedium = true;
      }
    }

    if (bounce >= i32(U.transport.y)) {
      let q = clamp(max(beta.x, max(beta.y, beta.z)), 0.0, 0.95);
      if (rng_next(state) >= q) { break; }
      beta = beta / q;
      environmentBeta = environmentBeta / q;
    }
  }
  return radiance;
}
`}function va(e){return`
struct MxCameraRay {
  origin: vec3<f32>,
  direction: vec3<f32>,
  backgroundDirection: vec3<f32>,
};

fn camera_ray(px : vec2<f32>, dims : vec2<f32>, jitter : vec2<f32>) -> MxCameraRay {
  let ndc = vec2<f32>(
    ((px.x + jitter.x) / dims.x) * 2.0 - 1.0,
    1.0 - ((px.y + jitter.y) / dims.y) * 2.0,
  );
  let near = U.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  // An interior depth avoids a zero homogeneous w at distant far planes in f32.
  let far = U.invViewProj * vec4<f32>(ndc, 0.5, 1.0);
  var ray : MxCameraRay;
  ray.origin = near.xyz / near.w;
  ray.direction = normalize(far.xyz / far.w - ray.origin);
  if (U.transport.w > 0.5) {
    ray.origin = U.eye.xyz;
    ray.direction = normalize(far.xyz / far.w - ray.origin);
  }
  ray.backgroundDirection = ray.direction;
  if (U.envTexture.y > 0.5) {
    let backgroundNear = U.backgroundInvViewProj * vec4<f32>(ndc, 0.0, 1.0);
    ray.backgroundDirection = normalize(backgroundNear.xyz / backgroundNear.w - U.eye.xyz);
  }
  return ray;
}

${e?`
fn camera_jitter(index: u32, pixel: u32) -> vec2f {
  var n = index + 1u;
  var base3 = 0.0;
  var place = 1.0 / 3.0;
  while (n > 0u) {
    base3 += f32(n % 3u) * place;
    n /= 3u;
    place /= 3.0;
  }
  let shift = vec2f(f32(pcg_hash(pixel)), f32(pcg_hash(pixel ^ 0x68bc21ebu))) * 2.3283064365386963e-10;
  return fract(vec2f(f32(reverseBits(index + 1u)) * 2.3283064365386963e-10, base3) + shift);
}
`:``}

@compute @workgroup_size(8, 8, 1)
fn ${aa}(@builtin(global_invocation_id) gid : vec3<u32>) {
  let width = u32(U.frame.z);
  let height = u32(U.frame.w);
  if (gid.x >= u32(U.tile.z) || gid.y >= u32(U.tile.w)) { return; }
  let pixelCoord = gid.xy + vec2<u32>(U.tile.xy);
  if (pixelCoord.x >= width || pixelCoord.y >= height) { return; }
  let pixel = pixelCoord.y * width + pixelCoord.x;
  let frameIndex = u32(U.frame.x);
  let spp = max(u32(U.frame.y), 1u);
  let dims = vec2<f32>(U.frame.z, U.frame.w);

  var state = pcg_hash(pixel + 0x9e3779b9u * (frameIndex + 1u));
  // eye.w carries an optional per-sample luminance clamp; 0 keeps the tracer
  // unbiased, > 0 tames glossy/env fireflies (hue-preserving down-scale).
  let fireflyMax = U.eye.w;
  var sample = vec3<f32>(0.0);
${e?`  var coverage = 0.0;`:``}
  for (var i = 0u; i < spp; i = i + 1u) {
    let jitter = ${e?`camera_jitter(frameIndex * spp + i, pixel)`:`vec2<f32>(rng_next(&state), rng_next(&state))`};
    let ray = camera_ray(vec2<f32>(pixelCoord), dims, jitter);
${e?`    var hitCoverage = 0.0;`:``}
    var radiance = integrate(ray.origin, ray.direction, ray.backgroundDirection, &state${e?`, &hitCoverage`:``});
${e?`    coverage += hitCoverage;`:``}
    if (fireflyMax > 0.0) {
      let lum = dot(radiance, vec3<f32>(0.2126, 0.7152, 0.0722));
      if (lum > fireflyMax) { radiance = radiance * (fireflyMax / lum); }
    }
    sample = sample + radiance;
  }
  sample = sample / f32(spp);

  // Progressive accumulation: running mean keyed by frame index.
${e?`  let outputPixel = pixel * 2u;`:``}
  let prev = accum[${e?`outputPixel`:`pixel`}];
  let count = prev.w;
  let sampleCount = f32(spp);
  let totalCount = count + sampleCount;
  let mean = (prev.xyz * count + sample * sampleCount) / totalCount;
  accum[${e?`outputPixel`:`pixel`}] = vec4<f32>(mean, totalCount);
${e?`  let oldCoverage = accum[outputPixel + 1u].x;
  let hits = coverage / f32(spp);
  accum[outputPixel + 1u] = vec4f((oldCoverage * count + hits * sampleCount) / totalCount, 0.0, 0.0, 0.0);`:``}
}
`}function ya(e={}){let t=e.textures??!1,n=e.environment??!1,r=e.dispatch,i=Math.min(Math.max(1,e.maxLobes??8),8),a=r?{primvarFields:r.primvarFields,extraInputs:r.extraInputs}:e.varyings,o=[la(t,a!==void 0,n),da(),fa(),ha(t,i,e.closureDispatch),...e.analyticLights?[Ur]:[],...a===void 0?[]:[ga(a)],...r===void 0?[]:[ba(r)],_a(t,r!==void 0,n,e.displayAovs??!1,e.opaque??!1,e.analyticLights??!1),va(e.displayAovs??!1)].join(`
`);return e.pruneUnusedFunctions?ia(o,[aa]):o}function ba(e){let t=[];e.preludes.length>0&&t.push(e.preludes.join(`
`)),e.uniforms.length>0&&t.push(`struct MxUniforms {\n${e.uniforms.map(e=>`  ${e.field}: ${e.wgslType},`).join(`
`)}\n};\n@group(0) @binding(8) var<uniform> u: MxUniforms;`);for(let n of e.textures)t.push(`@group(${n.group}) @binding(${n.binding}) var ${n.handle}: texture_2d<f32>;`);for(let n of e.samplers)t.push(`@group(${n.group}) @binding(${n.binding}) var ${n.handle}: sampler;`);return t.push(e.dispatcherWgsl),t.join(`

`)}function xa(e,t,n,r,i,a=0,o){let s=new Float32Array(104);s.set(e.camera.invViewProj,0),s.set([e.camera.eye[0],e.camera.eye[1],e.camera.eye[2],a],16),s.set([e.light.direction[0],e.light.direction[1],e.light.direction[2],0],20),s.set([e.light.color[0],e.light.color[1],e.light.color[2],e.light.intensity],24);let c=e.environment;if(c.hasTexture){let e=c.tint??[1,1,1];s.set([e[0],e[1],e[2],c.intensity??1],28)}else s.set([c.radiance[0],c.radiance[1],c.radiance[2],0],28);s.set([t,n,r,i],32);let l=c.hasTexture&&(c.envTotalSum??0)>0&&(c.envResX??0)>0?1:0;s.set([c.envResX??0,c.envResY??0,c.envTotalSum??0,l],36);let u=c.sh;if(u)for(let e=0;e<9;e++)s.set([u[e*3]??0,u[e*3+1]??0,u[e*3+2]??0,0],40+e*4);return s.set(o?[o.x,o.y,o.width,o.height]:[0,0,r,i],76),s[80]=c.textureRadianceScale??1,e.camera.backgroundInvViewProj&&(s[81]=1,s.set(e.camera.backgroundInvViewProj,84)),s.set([e.settings?.maxDepth??64,e.settings?.rouletteDepth??3,e.analyticLightCount??0,+!!e.settings?.converted],100),s}var Sa=class{#e;#t;#n=null;#r=0;#i=0;constructor(e,t={}){this.#e=e,this.#t=t}get frameIndex(){return this.#r}resetAccumulation(){this.#r=0,this.#i=0}advanceTile(e,t){let n=this.#r,r=ca(e,t,this.#i);return this.#i+=1,this.#i===16&&(this.#i=0,this.#r+=1),{tile:r,frameIndex:n}}advanceFrame(){let e=this.#r;return this.#r+=1,this.#i=0,e}createPipeline(e){if(this.#n)return this.#n;let t=ya(this.#t),n=e??this.#e.createShaderModule({code:t}),r=this.#e.createComputePipeline({layout:`auto`,compute:{module:n,entryPoint:aa}});return this.#n={pipeline:r,module:n},this.#n}async createPipelineAsync(e){if(this.#n)return this.#n;let t=await this.#e.createComputePipelineAsync({layout:`auto`,compute:{module:e,entryPoint:aa}});return this.#n={pipeline:t,module:e},this.#n}static workgroupCount(e,t){return[Math.ceil(e/8),Math.ceil(t/8)]}};function Ca(e){let t=e.prims.get(`/${e.stage.defaultPrim??`World`}`),n=typeof t?.attributes.get(`pathtracer:sourceScene`)?.value==`string`,r=t?.attributes.get(`pathtracer:maxDepth`)?.value;if(r!==void 0&&(typeof r!=`number`||!Number.isInteger(r)||r<0||r>64))throw Error(`pathtracer:maxDepth must be an integer between 0 and 64.`);return{converted:n,maxDepth:typeof r==`number`?r:64,rouletteDepth:n?2:3}}function wa(e,t){return e.pathtracerFov===void 0?e.fovY:2*Math.atan(Math.tan(e.pathtracerFov*Math.PI/360)/t)}var Ta={focalLength:50,horizontalAperture:20.955,verticalAperture:15.2908,near:1,far:1e6};function Ea(e,t){let n=e.attributes.get(t)?.value;return typeof n==`number`?n:void 0}function Da(e,t){let n=e.attributes.get(t)?.value;if(Array.isArray(n)&&n.length>=2&&typeof n[0]==`number`&&typeof n[1]==`number`)return[n[0],n[1]]}function Oa(e,t){let n=e.attributes.get(t)?.value;return typeof n==`string`?n:void 0}function ka(t,n={}){let r=n.transforms??f(t,n.sink),i=[];for(let[n,a]of t.prims){if(a.typeName!==`Camera`)continue;let t=Oa(a,`projection`)===`orthographic`?`orthographic`:`perspective`,o=Ea(a,`focalLength`)??Ta.focalLength,s=Ea(a,`horizontalAperture`)??Ta.horizontalAperture,c=Ea(a,`verticalAperture`)??Ta.verticalAperture,u=Ea(a,`horizontalApertureOffset`)??0,d=Ea(a,`verticalApertureOffset`)??0,f=Da(a,`clippingRange`)??[Ta.near,Ta.far],h=Ea(a,`fStop`),g=Ea(a,`focusDistance`),_=Ea(a,`exposure`),v=Ea(a,`pathtracer:fov`);if(v!==void 0&&(!Number.isFinite(v)||v<=0||v>=180))throw Error(`Invalid pathtracer:fov at ${n}; expected degrees between 0 and 180.`);let y=r.get(n)??e,b=l(y),x=c===0?1:s/c,[S,C]=f,w=0,T;if(t===`orthographic`){let e=s/10/2,t=c/10/2;T=m(-e,e,-t,t,S,C)}else w=2*Math.atan(c/(2*o)),T=p(w,x,S,C);i.push({path:n,projection:t,focalLength:o,horizontalAperture:s,verticalAperture:c,horizontalApertureOffset:u,verticalApertureOffset:d,clippingRange:f,...h===void 0?{}:{fStop:h},...g===void 0?{}:{focusDistance:g},..._===void 0?{}:{exposure:_},transform:y,view:b,fovY:w,aspectRatio:x,projectionMatrix:T,...v===void 0?{}:{pathtracerFov:v}})}return i}var Aa=65504,ja=new Float32Array(1),Ma=new Uint32Array(ja.buffer);function Na(e){ja[0]=e;let t=Ma[0],n=(t>>>23&255)-127+15,r=t&8388607;return n<=0?n<-10?0:(r=(r|8388608)>>>1-n,r>>>13):n<<10|r>>>13}function Pa(e){let{width:t,height:n,data:r}=e;if(!Number.isInteger(t)||!Number.isInteger(n)||t<=0||n<=0||r.length!==t*n*3)throw Error(`Invalid HDR image dimensions`);let i=0;for(let e of r){if(!Number.isFinite(e)||e<0)throw Error(`HDR radiance must be finite and nonnegative`);i=Math.max(i,e)}let a=i>Aa?2**Math.ceil(Math.log2(i/Aa)):1,o=new Uint16Array(t*n*4);for(let e=0;e<t*n;e++){for(let t=0;t<3;t++)o[e*4+t]=Na(r[e*3+t]/a);o[e*4+3]=15360}return{data:o,radianceScale:a}}function Fa(e){let t=e=>{switch(e){case void 0:case`periodic`:return`repeat`;case`clamp`:return`clamp-to-edge`;case`mirror`:return`mirror-repeat`;case`constant`:return`clamp-to-edge`;default:throw Error(`Unsupported MaterialX image address mode '${e}'.`)}},n;switch(e.filter){case`closest`:n=`nearest`;break;case void 0:case`linear`:case`cubic`:n=`linear`;break;default:throw Error(`Unsupported MaterialX image filter '${e.filter}'.`)}return{addressModeU:t(e.addressU),addressModeV:t(e.addressV),magFilter:n,minFilter:n}}function Ia(e,t){let n=[{binding:0,role:`uniform`,usage:`uniform`,access:`read`},{binding:1,role:`nodes`,usage:`storage`,access:`read`,data:e.nodes},{binding:2,role:`triangles`,usage:`storage`,access:`read`,data:e.triangles},{binding:3,role:`triangleOrder`,usage:`storage`,access:`read`,data:e.triangleOrder},{binding:4,role:`materials`,usage:`storage`,access:`read`,data:e.materials},{binding:5,role:`accum`,usage:`storage`,access:`read_write`},{binding:6,role:`triangleUv`,usage:`storage`,access:`read`,data:e.triangleUv},{binding:7,role:`triangleTangent`,usage:`storage`,access:`read`,data:e.triangleTangent}];return t.uniforms.length>0&&n.push({binding:8,role:`mxUniforms`,usage:`uniform`,access:`read`}),e.analyticLights&&n.push({binding:9,role:`analyticLights`,usage:`storage`,access:`read`,data:e.analyticLights}),n}async function La(e,t,n,r={}){let i=r.sink??(()=>void 0),a=e.textureRegistry,o=[];for(let e of a.images){if(e===void 0){o.push(void 0);continue}let t=await n.decode(e);t||i({level:`warning`,message:`Texture image failed to decode: ${e}`,detail:{file:e}}),o.push(t??void 0)}let s=a.textures.map((e,t)=>({binding:e.binding,handle:e.handle,imageIndex:a.textureImage[t],format:a.textures[t].colorSpace===`srgb_texture`?`rgba8unorm-srgb`:`rgba8unorm`})),c=a.samplers.map(e=>({binding:e.binding,handle:e.handle,descriptor:Fa(e.sampler??{})}));return{group0:Ia(t,e),textures:s,samplers:c,images:o}}function Ra(e){if(Array.isArray(e))return e;let t=[];for(let n=0;n<e.size();n++)t.push(e.get(n));return t}function za(e){return e!==void 0&&e!==``?e:void 0}function Ba(e){let t=za(e.getActiveSourceUri?.());return t===void 0?{namePath:e.getNamePath()}:{namePath:e.getNamePath(),sourceUri:t}}function Va(e){if(e.getCategory?.()===`nodegraph`)return{kind:`nodegraph`,name:e.getName()};let t=za(e.getTarget?.()),n=za(e.getFunction?.());return{kind:`sourcecode`,...t===void 0?{}:{target:t},...n===void 0?{}:{function:n}}}function Ha(e){let t=e.getName(),n=e.getType(),r=Ba(e),i=za(e.getColorSpace?.()),a=za(e.getUnit?.()),o=za(e.getUnitType?.()),s,c=null,l=za(e.getInterfaceName?.()),u=e.getConnectedNode?.()??null,d=e.getValueString(),f=e.hasValue?e.hasValue():d!==``;if(l!==void 0){let t=e.getInterfaceInput?.()??null,r=t?.getConnectedNode?.()??null;if(r){c=r;let e=za(t?.getOutputString?.());s=e===void 0?{kind:`connection`,nodeId:r.getNamePath()}:{kind:`connection`,nodeId:r.getNamePath(),output:e}}else if(t){let e=t.getValueString();s=(t.hasValue?t.hasValue():e!==``)?{kind:`value`,value:e,type:n}:{kind:`interface`,name:l}}else s={kind:`interface`,name:l}}else if(u){c=u;let t=za(e.getNodeGraphString?.())===void 0?za(e.getOutputString?.()):za(e.getConnectedOutput?.()?.getOutputString?.());s=t===void 0?{kind:`connection`,nodeId:u.getNamePath()}:{kind:`connection`,nodeId:u.getNamePath(),output:t}}else s=f?{kind:`value`,value:d,type:n}:{kind:`default`,type:n};return{resolved:{name:t,type:n,source:s,...l===void 0?{}:{interfaceName:l},...i===void 0?{}:{colorSpace:i},...a===void 0?{}:{unit:a},...o===void 0?{}:{unitType:o},provenance:r},connected:c}}function Ua(e,t,n,r){let i=t??``,a=e.getNodeDef?.(i)??null;if(!a){n({level:`warning`,message:`Unresolved NodeDef for node '${e.getCategory()}' (${e.getNamePath()}).`,detail:{node:e.getNamePath()}});return}let o=a.getImplementation?.(i)??null,s=o?Va(o):{kind:`unresolved`};!o&&!(r?.(e.getCategory())??!1)&&n({level:`warning`,message:`NodeDef '${a.getName()}' has no implementation for target '${t??`<any>`}'; explicit WGSL lowering required.`,detail:{nodeDef:a.getName()}});let c=za(a.getNodeGroup?.()),l=za(a.getVersionString?.()),u=Ra(a.getActiveInputs?.()??a.getInputs?.()??[]).map(e=>{let t=za(e.getValueString()),n=za(e.getDefaultGeomPropString?.());return{name:e.getName(),type:e.getType(),...t===void 0?{}:{value:t},...n===void 0?{}:{geomprop:n}}});return{name:a.getName(),nodeString:a.getNodeString(),type:a.getType(),...c===void 0?{}:{nodeGroup:c},...l===void 0?{}:{version:l},...u.length>0?{inputs:u}:{},implementation:s}}function Wa(e){let t=e.onDiagnostic??Cn,n=new Map,r=[],i=[];for(let t of e.roots){let e={name:t.name,type:t.type,...t.node?{nodeId:t.node.getNamePath()}:{},provenance:t.provenance??(t.node?Ba(t.node):{namePath:t.name})};r.push(e),t.node&&i.push(t.node)}for(;i.length>0;){let r=i.pop(),a=r.getNamePath();if(n.has(a))continue;let o=[];for(let e of Ra(r.getInputs())){let{resolved:t,connected:n}=Ha(e);o.push(t),n&&i.push(n)}let s=Ua(r,e.target,t,e.isCovered);n.set(a,{id:a,category:r.getCategory(),type:r.getType(),...s?{nodeDef:s}:{},inputs:o,provenance:Ba(r)})}return{terminals:r,nodes:n}}function Ga(e,t){if(e===`boolean`)return[+(t.trim()===`true`)];let n=t.split(`,`).map(e=>Number.parseFloat(e.trim())),r=e=>e!==void 0&&Number.isFinite(e)?e:0;if(e===`float`||e===`integer`)return[r(n[0])];let i=[];for(let e=0;e<3;e++)i.push(r(n[e]));return i}var z=(e,t)=>({name:e,type:`float`,default:[t]}),B=(e,t,n,r)=>({name:e,type:`color3`,default:[t,n,r]}),Ka=(e,t)=>({name:e,type:`integer`,default:[t]}),qa=(e,t)=>({name:e,type:`boolean`,default:[+!!t]}),Ja=(e,t)=>({name:e,type:`vector3`,geomprop:t}),Ya=(e,t,n,r)=>({name:e,type:`vector3`,default:[t,n,r]}),Xa=[z(`base`,.8),B(`base_color`,1,1,1),z(`diffuse_roughness`,0),z(`metalness`,0),z(`specular`,1),B(`specular_color`,1,1,1),z(`specular_roughness`,.2),z(`specular_IOR`,1.5),z(`specular_anisotropy`,0),z(`specular_rotation`,0),z(`transmission`,0),B(`transmission_color`,1,1,1),z(`transmission_depth`,0),B(`transmission_scatter`,0,0,0),z(`transmission_scatter_anisotropy`,0),z(`transmission_dispersion`,0),z(`transmission_extra_roughness`,0),z(`subsurface`,0),B(`subsurface_color`,1,1,1),B(`subsurface_radius`,1,1,1),z(`subsurface_scale`,1),z(`subsurface_anisotropy`,0),z(`sheen`,0),B(`sheen_color`,1,1,1),z(`sheen_roughness`,.3),z(`coat`,0),B(`coat_color`,1,1,1),z(`coat_roughness`,.1),z(`coat_anisotropy`,0),z(`coat_rotation`,0),z(`coat_IOR`,1.5),Ja(`coat_normal`,`Nworld`),z(`coat_affect_color`,0),z(`coat_affect_roughness`,0),z(`thin_film_thickness`,0),z(`thin_film_IOR`,1.5),z(`emission`,0),B(`emission_color`,1,1,1),B(`opacity`,1,1,1),qa(`thin_walled`,!1),Ja(`normal`,`Nworld`),Ja(`tangent`,`Tworld`)],Za=new Map([[`base`,z(`base`,1)],[`base_color`,B(`base_color`,.8,.8,.8)]]),Qa=[z(`base_weight`,1),B(`base_color`,.8,.8,.8),z(`base_diffuse_roughness`,0),z(`base_metalness`,0),z(`specular_weight`,1),B(`specular_color`,1,1,1),z(`specular_roughness`,.3),z(`specular_ior`,1.5),z(`specular_roughness_anisotropy`,0),z(`transmission_weight`,0),B(`transmission_color`,1,1,1),z(`transmission_depth`,0),B(`transmission_scatter`,0,0,0),z(`transmission_scatter_anisotropy`,0),z(`transmission_dispersion_scale`,0),z(`transmission_dispersion_abbe_number`,20),z(`subsurface_weight`,0),B(`subsurface_color`,.8,.8,.8),z(`subsurface_radius`,1),B(`subsurface_radius_scale`,1,.5,.25),z(`subsurface_scatter_anisotropy`,0),z(`fuzz_weight`,0),B(`fuzz_color`,1,1,1),z(`fuzz_roughness`,.5),z(`coat_weight`,0),B(`coat_color`,1,1,1),z(`coat_roughness`,0),z(`coat_roughness_anisotropy`,0),z(`coat_ior`,1.6),z(`coat_darkening`,1),z(`thin_film_weight`,0),z(`thin_film_thickness`,.5),z(`thin_film_ior`,1.4),z(`emission_luminance`,0),B(`emission_color`,1,1,1),z(`geometry_opacity`,1),qa(`geometry_thin_walled`,!1),Ja(`geometry_normal`,`Nworld`),Ja(`geometry_coat_normal`,`Nworld`),Ja(`geometry_tangent`,`Tworld`),Ja(`geometry_coat_tangent`,`Tworld`)],$a=[B(`base_color`,1,1,1),z(`metallic`,1),z(`roughness`,1),Ja(`normal`,`Nworld`),Ja(`tangent`,`Tworld`),z(`occlusion`,1),z(`transmission`,0),z(`specular`,1),B(`specular_color`,1,1,1),z(`ior`,1.5),z(`alpha`,1),Ka(`alpha_mode`,0),z(`alpha_cutoff`,.5),z(`iridescence`,0),z(`iridescence_thickness`,100),B(`sheen_color`,0,0,0),z(`sheen_roughness`,0),z(`clearcoat`,0),z(`clearcoat_roughness`,0),Ja(`clearcoat_normal`,`Nworld`),B(`emissive`,0,0,0),z(`anisotropy_strength`,0),z(`anisotropy_rotation`,0),z(`dispersion`,0)],eo=[B(`diffuseColor`,.18,.18,.18),B(`emissiveColor`,0,0,0),Ka(`useSpecularWorkflow`,0),B(`specularColor`,0,0,0),z(`metallic`,0),z(`roughness`,.5),z(`clearcoat`,0),z(`clearcoatRoughness`,.01),z(`opacity`,1),z(`opacityThreshold`,0),z(`ior`,1.5),Ya(`normal`,0,0,1),z(`displacement`,0),z(`occlusion`,1)],to=[B(`baseColor`,.16,.16,.16),z(`metallic`,0),z(`roughness`,.5),z(`anisotropic`,0),z(`specular`,.5),z(`specularTint`,0),z(`sheen`,0),z(`sheenTint`,.5),z(`clearcoat`,0),z(`clearcoatGloss`,1),z(`specTrans`,0),z(`ior`,1.5),z(`subsurface`,0),B(`subsurfaceDistance`,1,1,1)],no={simple_hair:[z(`melaninConcentration`,.5),z(`melaninRedness`,.5),z(`melaninMix`,1),B(`baseColor`,1,1,1),z(`longitudinalRoughness`,.1),z(`azimuthalRoughness`,.1),z(`cuticleAngle`,.5),B(`tint_R`,1,1,1),B(`tint_TT`,1,1,1),B(`tint_TRT`,1,1,1),z(`ior`,1.55)],standard_surface:Xa,open_pbr_surface:Qa,disney_principled:to,gltf_pbr:$a,UsdPreviewSurface:eo},ro=new Set(Object.keys(no)),io=new Set(`image.tiledimage.hextiledimage.constant.multiply.add.subtract.divide.min.max.clamp.range.mix.combine2.combine3.combine4.separate3.convert.rgbtohsv.hsvtorgb.normalmap.noise2d.noise3d.fractal2d.fractal3d.cellnoise2d.cellnoise3d.position.normal.tangent.texcoord.geompropvalue.dot.extract.swizzle`.split(`.`));function ao(e){return e.geomprop===void 0?{kind:`default`,value:e.default??[0]}:{kind:`geomprop`,name:e.geomprop}}function oo(e,t){let n=no[e];return e!==`standard_surface`||t===`1.0.0`?n:n.map(e=>Za.get(e.name)??e)}function so(e,t={}){let n=t.onDiagnostic??Cn,r=t.supportedUpstream??io,i=e.terminals.find(e=>e.name===`surfaceshader`);if(!i||i.nodeId===void 0)return n({level:`error`,message:`No surfaceshader terminal connected; cannot resolve a surface closure (REQ-013).`,detail:{terminals:e.terminals.map(e=>e.name)}}),null;let a=e.nodes.get(i.nodeId);if(!a)return n({level:`error`,message:`Surfaceshader terminal references missing node '${i.nodeId}' (REQ-013).`,detail:{nodeId:i.nodeId}}),null;let o=a.nodeDef?.nodeString??a.category;if(!ro.has(o))return n({level:`error`,message:`Unsupported surface family '${o}' (${a.id}); no LayeredClosure lowering available (REQ-013).`,detail:{nodeId:a.id,category:a.category,nodeString:a.nodeDef?.nodeString}}),null;let s=o,c=a.nodeDef?.version,l=oo(s,c),u=a.nodeDef?.inputs?.length?a.nodeDef.inputs.flatMap(e=>{if(![`float`,`color3`,`vector3`,`integer`,`boolean`].includes(e.type))return[];let t=e.type,n=l.find(t=>t.name===e.name);return[{name:e.name,type:t,...e.geomprop?{geomprop:e.geomprop}:e.value===void 0?n?.geomprop?{geomprop:n.geomprop}:{default:n?.default??[0]}:{default:Ga(t,e.value)}}]}):l,d=new Set(u.map(e=>e.name)),f=new Map(a.inputs.map(e=>[e.name,e])),p=new Map;for(let i of u){let a=f.get(i.name),o;if(!a)o=ao(i);else switch(a.source.kind){case`value`:o={kind:`value`,value:Ga(i.type,a.source.value)};break;case`connection`:{let t=e.nodes.get(a.source.nodeId)?.category;t!==void 0&&!r.has(t)&&n({level:`warning`,message:`Input '${s}.${i.name}' is driven by unsupported node '${t}' (${a.source.nodeId}); its contribution would be lost (REQ-013).`,detail:{family:s,input:i.name,nodeId:a.source.nodeId,category:t}}),o=a.source.output===void 0?{kind:`connection`,nodeId:a.source.nodeId}:{kind:`connection`,nodeId:a.source.nodeId,output:a.source.output};break}case`interface`:{let e=t.interface?.get(a.source.name);e?o=e:(n({level:`warning`,message:`Interface input '${a.source.name}' for '${s}.${i.name}' is unresolved; falling back to the nodedef default (REQ-013).`,detail:{family:s,input:i.name,interfaceName:a.source.name}}),o=ao(i));break}case`default`:o=ao(i)}p.set(i.name,{name:i.name,type:i.type,source:o})}for(let e of a.inputs)d.has(e.name)||n({level:`warning`,message:`Unknown input '${e.name}' on '${s}' surface (${a.id}); not part of the nodedef interface and ignored (REQ-013).`,detail:{family:s,input:e.name,nodeId:a.id}});return{family:s,nodeId:a.id,...a.nodeDef?.name===void 0?{}:{nodeDefName:a.nodeDef.name},...c===void 0?{}:{version:c},inputs:p}}function co(){let e=new Ge,t=e.constant(N,1),n=e.add({kind:`closure`,type:Be(`surface`),closure:`bsdf`,op:`surface`,params:{opacity:t}});return e.output({name:`surfaceshader`,type:Be(`surface`),ref:n}),e.build()}function lo(e){let t=e.terminals.find(e=>e.name===`displacementshader`);if(!t?.nodeId)return;let n=e.nodes.get(t.nodeId);if(!n||n.category!==`displacement`)return;let r=1,i=n.inputs.find(e=>e.name===`scale`);if(i?.source.kind===`value`){let e=Number(i.source.value);Number.isFinite(e)&&(r=e)}let a=n.inputs.find(e=>e.name===`displacement`);if(a?.source.kind!==`connection`)return;let o=e.nodes.get(a.source.nodeId),s=o?.inputs.find(e=>e.name===`file`);if(s?.source.kind!==`value`)return;let c=String(s.source.value);if(!c)return;if(o?.category!==`tiledimage`)return{file:c,scale:r};let l=(e,t)=>{let n=o.inputs.find(t=>t.name===e)?.source,r=n?.kind===`value`?n.value:o.nodeDef?.inputs?.find(t=>t.name===e)?.value;if(r===void 0)return[...t];let i=r.split(`,`).map(Number);if(i.length!==2||!i.every(Number.isFinite))throw Error(`Invalid displacement ${e}`);return[i[0],i[1]]},u=l(`uvtiling`,[1,1]),d=l(`uvoffset`,[0,0]),f=l(`realworldimagesize`,[1,1]),p=l(`realworldtilesize`,[1,1]);if(f.some(e=>e===0))throw Error(`Displacement realworldimagesize must be nonzero.`);return{file:c,scale:r,uvScale:[u[0]*p[0]/f[0],u[1]*p[1]/f[1]],uvOffset:[-d[0]*p[0]/f[0],-d[1]*p[1]/f[1]]}}function uo(e){let t=e.sink??(()=>void 0);return{compile(n){let r=e.documents.documentFor(n);if(!r)t({level:`warning`,message:`No MaterialX document for material ${n.materialName}`,detail:{material:n.materialName}});else try{let i=ln(r,n.materialName,{sink:t});if(i.length===0)return;let a=Wa({roots:i,onDiagnostic:t,isCovered:e=>pr(e)||vr.has(e),...e.target===void 0?{}:{target:e.target}}),o=so(a,{onDiagnostic:t,supportedUpstream:vr,...e.surfaceOptions});if(!o){t({level:`warning`,message:`Unresolved surface for material ${n.materialName}`,detail:{material:n.materialName}});return}let s=Xi(a,o,t),c=co(),l=lo(a);return{ir:c,module:Oi(c),layered:s,graph:a,surface:o,...l?{displacement:l}:{}}}catch(e){let r=e instanceof Error?e.message:String(e),i=e instanceof Error?e.stack??``:``;t({level:`error`,message:`Material compile failed for ${n.materialName}: ${r}`,detail:{material:n.materialName,stack:i}});return}}}}async function fo(e){let t=e.sink??(()=>void 0),n=new Map;for(let[r,i]of e.texts){let a=e.core.createDocument();try{await e.core.readXmlString(a,i,{...e.searchPath===void 0?{}:{searchPath:e.searchPath},readXIncludes:!0}),e.libraries.importInto(a)}catch(e){a.delete(),t({level:`error`,message:`Failed to read MaterialX document ${r}: ${e instanceof Error?e.message:String(e)}`,detail:{asset:r}});continue}n.set(r,a)}return{documentFor(e){return n.get(e.assetPath)},delete(){for(let e of n.values())e.delete();n.clear()}}}var po=`modulepreload`,mo=function(e,t){return new URL(e,t).href},ho={},go=function(e){return e.pathname.endsWith(`.css`)},_o=function(e,t,n){if(t in e)return e[t];let r=n();if(!r){e[t]=void 0;return}let i=r.then(()=>{e[t]=void 0},n=>{throw e[t]=void 0,n});return e[t]=i,i},vo=function(e,t,n){let r=Promise.resolve();if(t&&t.length>0){let e,i=document.querySelector(`meta[property=csp-nonce]`),a=i?.nonce||i?.getAttribute(`nonce`);function o(e){return Promise.all(e.map(e=>Promise.resolve(e).then(e=>({status:`fulfilled`,value:e}),e=>({status:`rejected`,reason:e}))))}function s(e){return import.meta.resolve?new URL(import.meta.resolve(e)):new URL(e,import.meta.url)}r=o(t.map(t=>{t=mo(t,n);let r=s(t),i=go(r);return _o(ho,r.href,()=>{if(e===void 0){e={all:new Set,styles:new Set};let t=document.getElementsByTagName(`link`);for(let n=t.length-1;n>=0;n--){let r=t[n];e.all.add(r.href),r.rel===`stylesheet`&&e.styles.add(r.href)}}if((i?e.styles:e.all).has(r.href))return;let t=document.createElement(`link`);if(t.rel=i?`stylesheet`:po,i||(t.as=`script`),t.crossOrigin=``,t.href=r.href,a&&t.setAttribute(`nonce`,a),document.head.appendChild(t),i)return new Promise((e,n)=>{t.addEventListener(`load`,e),t.addEventListener(`error`,()=>n(Error(`Unable to preload CSS for ${r}`)))})})}).filter(e=>e!==void 0))}function i(e){let t=new Event(`vite:preloadError`,{cancelable:!0});if(t.payload=e,window.dispatchEvent(t),!t.defaultPrevented)throw e}return r.then(t=>{for(let e of t||[])e.status===`rejected`&&i(e.reason);return e().catch(i)})},yo=class extends Error{name=`MaterialXError`},bo=class{module;diag;constructor(e,t=Cn){this.module=e,this.diag=t}createDocument(){return this.module.createDocument()}async readXmlString(e,t,n={}){let{searchPath:r=``,readXIncludes:i=!0}=n,a=this.makeReadOptions(i);try{await this.module.readFromXmlString(e,t,r,a??null)}catch(e){let t=e instanceof Error?e.message:String(e);throw this.diag({level:`error`,message:`MaterialX XML read failed: ${t}`,detail:e}),new yo(t)}finally{a?.delete()}}validate(e){let t=e.validate();return t||this.diag({level:`error`,message:`MaterialX document failed structural validation.`}),t}makeReadOptions(e){let t=this.module.XmlReadOptions;if(!t)return;let n=new t;return n.readXIncludes=e,n}},xo;function So(e={}){return xo||(xo=Co(e).catch(e=>{throw xo=void 0,e}),xo)}async function Co(e){let t=e.onDiagnostic??Cn,n=e.factory??await wo(e.moduleUrl),r={};return e.locateFile&&(r.locateFile=e.locateFile),new bo(await n(r),t)}async function wo(e){if(!e)throw new yo("loadMaterialXCore requires either `factory` or `moduleUrl`.");let t=await vo(()=>import(e),[],import.meta.url),n=t.default??t;if(typeof n!=`function`)throw new yo(`Module at ${e} does not export a MaterialX factory.`);return n}var To=[`targets/genglsl.mtlx`,`targets/genmsl.mtlx`,`targets/genosl.mtlx`,`targets/genmdl.mtlx`,`stdlib/stdlib_defs.mtlx`,`stdlib/stdlib_ng.mtlx`,`pbrlib/pbrlib_defs.mtlx`,`pbrlib/pbrlib_ng.mtlx`,`cmlib/cmlib_defs.mtlx`,`cmlib/cmlib_ng.mtlx`,`bxdf/standard_surface.mtlx`,`bxdf/open_pbr_surface.mtlx`,`bxdf/gltf_pbr.mtlx`,`bxdf/usd_preview_surface.mtlx`,`bxdf/disney_principled.mtlx`],Eo=`<materialx version="1.39">
${[`float`,`color3`,`color4`,`vector2`,`vector3`,`vector4`].map(e=>`
  <nodedef name="ND_engine_image_${e}" node="image" inherit="ND_image_${e}">
    <input name="uvtiling" type="vector2" value="1, 1" />
    <input name="uvoffset" type="vector2" value="0, 0" />
    <input name="uv_scale" type="vector2" value="1, 1" />
    <input name="uv_offset" type="vector2" value="0, 0" />
  </nodedef>`).join(``)}
</materialx>`;function Do(e,t=To){let n=e.replace(/\/+$/,``);return t.map(e=>({name:e,url:`${n}/${e}`}))}var Oo=class{core;libraryDoc;constructor(e){this.core=e}async load(e){if(this.libraryDoc)return this.libraryDoc;let t=e.onDiagnostic??Cn,n=this.core.createDocument();try{Tn(e.signal);let t=await Promise.all(e.sources.map(t=>e.fetchText(t.url,e.signal)));for(let r of t)Tn(e.signal),await this.core.readXmlString(n,r,{...e.searchPath===void 0?{}:{searchPath:e.searchPath},readXIncludes:!0});e.sources.some(e=>e.name===`stdlib/stdlib_defs.mtlx`)&&await this.core.readXmlString(n,Eo,{readXIncludes:!1})}catch(e){throw n.delete(),t({level:`error`,message:`Failed to load MaterialX libraries: ${e instanceof Error?e.message:String(e)}`,detail:e}),e}if(!this.core.validate(n))throw n.delete(),Error(`MaterialX library document failed validation.`);return this.libraryDoc=n,n}importInto(e){if(!this.libraryDoc)throw Error(`MaterialXLibraries.importInto called before load().`);for(let t of e.getNodes?.()??[]){let n=t.getName();if(this.libraryDoc.getChild?.(n)?.getCategory?.()!==`nodedef`)continue;let r=`${n}_content`;for(let t=1;e.getChild?.(r)||this.libraryDoc.getChild?.(r);t++)r=`${n}_content${t}`;let i=t.getDownstreamPorts();t.setName(r);for(let e of i)e.setNodeName(r)}e.importLibrary(this.libraryDoc)}delete(){this.libraryDoc?.delete(),this.libraryDoc=void 0}},ko=new WeakMap;function Ao(e,t){let n=ko.get(e);n||(n=new Map,ko.set(e,n));let r=JSON.stringify([t.sources,t.searchPath]),i=n.get(r);if(i)return i;let a=new Oo(e),o=a.load(t).then(()=>a,e=>{throw n.delete(r),e});return n.set(r,o),o}async function jo(e,t){let n=e.type.split(`;`)[0]?.trim().toLowerCase()===`image/svg+xml`||/\.svg(?:[?#]|$)/i.test(t),r,i;try{if(n){i=URL.createObjectURL(e.type===`image/svg+xml`?e:new Blob([e],{type:`image/svg+xml`}));let t=new Image;t.src=i,await t.decode(),r=t}else r=await createImageBitmap(e);try{let e=r instanceof HTMLImageElement?r.naturalWidth:r.width,n=r instanceof HTMLImageElement?r.naturalHeight:r.height;if(e<=0||n<=0)throw Error(`Texture has no raster dimensions: ${t}`);let i=document.createElement(`canvas`);i.width=e,i.height=n;let a=i.getContext(`2d`);if(!a)throw Error(`Cannot create a 2D context for texture: ${t}`);a.drawImage(r,0,0);let o=a.getImageData(0,0,e,n);return{kind:`pixels`,data:new Uint8Array(o.data),componentType:`uint8`,channels:4,width:e,height:n,colorSpace:`lin_rec709`}}finally{`close`in r&&r.close()}}finally{i!==void 0&&URL.revokeObjectURL(i)}}function V(e,t){return typeof e==`number`&&Number.isFinite(e)?e:t}function Mo(e,t){return Array.isArray(e)&&e.length>=3?[e[0]??0,e[1]??0,e[2]??0]:[t[0],t[1],t[2]]}function No(e,t){return[e[0]*t,e[1]*t,e[2]*t]}function Po(e){let t=e.inputs;switch(e.category){case`simple_hair`:{let e=Math.max(0,Math.min(1,V(t.melaninMix,1))),n=V(t.azimuthalRoughness,.1),r=y(Mo(t.baseColor,[1,1,1]),n),i=v(V(t.melaninConcentration,.5),V(t.melaninRedness,.5));return{baseColor:[Math.exp(-2*(r[0]*(1-e)+i[0]*e)),Math.exp(-2*(r[1]*(1-e)+i[1]*e)),Math.exp(-2*(r[2]*(1-e)+i[2]*e))],metalness:0,roughness:V(t.longitudinalRoughness,.1),transmission:0,subsurface:0,ior:V(t.ior,1.55),specular:1}}case`standard_surface`:{let e=V(t.base,1);return{baseColor:No(Mo(t.base_color,[.8,.8,.8]),e),metalness:V(t.metalness,0),roughness:V(t.specular_roughness,.2),transmission:V(t.transmission,0),subsurface:V(t.subsurface,0),ior:V(t.specular_IOR,1.5),specular:V(t.specular,1)}}case`open_pbr_surface`:{let e=V(t.base_weight,1);return{baseColor:No(Mo(t.base_color,[.8,.8,.8]),e),metalness:V(t.base_metalness,0),roughness:V(t.specular_roughness,.3),transmission:V(t.transmission_weight,0),subsurface:V(t.subsurface_weight,0),ior:V(t.specular_ior,1.5),specular:V(t.specular_weight,1)}}case`disney_principled`:return{baseColor:Mo(t.baseColor,[.8,.8,.8]),metalness:V(t.metallic,0),roughness:V(t.roughness,.5),transmission:V(t.specTrans,0),subsurface:V(t.subsurface,0),ior:V(t.ior,1.5),specular:1};case`gltf_pbr`:return{baseColor:Mo(t.base_color,[1,1,1]),metalness:V(t.metallic,1),roughness:V(t.roughness,1),transmission:V(t.transmission,0),subsurface:0,ior:V(t.ior,1.5),specular:V(t.specular,1)};case`UsdPreviewSurface`:return{baseColor:Mo(t.diffuseColor,[.18,.18,.18]),metalness:V(t.metallic,0),roughness:V(t.roughness,.5),transmission:V(t.opacityThreshold,0)>0?0:1-Math.min(1,Math.max(0,V(t.opacity,1))),subsurface:0,ior:V(t.ior,1.5),specular:1};default:throw Error(`unmapped surface family '${e.category}'`)}}var Fo=[`simple_hair`,`standard_surface`,`open_pbr_surface`,`disney_principled`,`gltf_pbr`,`UsdPreviewSurface`];function Io(e){let t={},n=/<input\s+name="([^"]+)"\s+type="([^"]+)"\s+value="([^"]*)"/g,r;for(;(r=n.exec(e))!==null;){let[,e,n,i]=r;e!==void 0&&n!==void 0&&i!==void 0&&(n===`color3`||n===`vector3`?t[e]=i.split(`,`).map(e=>Number.parseFloat(e.trim())):n===`float`||n===`integer`?t[e]=Number.parseFloat(i):n===`boolean`&&(t[e]=i.trim()===`true`))}return t}function Lo(e){for(let t of Fo){let n=RegExp(`<${t}\\b[\\s\\S]*?</${t}>`,`m`).exec(e);if(n)return{category:t,inputs:Io(n[0])}}return null}var Ro={SphereLight:`sphere`,DistantLight:`distant`,RectLight:`rect`,DiskLight:`disk`,CylinderLight:`cylinder`,DomeLight:`dome`};function zo(e,t){let n=e.attributes.get(t)?.value;return typeof n==`number`?n:void 0}function Bo(e,t){let n=e.attributes.get(t)?.value;return typeof n==`boolean`?n:void 0}function Vo(e,t){let n=e.attributes.get(t)?.value;return typeof n==`string`&&n.length>0?n:void 0}function Ho(e,t){let n=e.attributes.get(t)?.value;if(Array.isArray(n)&&n.length>=3&&typeof n[0]==`number`)return[n[0],n[1],n[2]]}function Uo(t,n={}){let r=n.transforms??f(t,n.sink),i=[];for(let[a,o]of t.prims){let t=o.typeName;if(t===void 0)continue;let s=Ro[t];if(!(s!==void 0||t.endsWith(`Light`)))continue;let c=s??`unknown`;c===`unknown`&&n.sink?.({level:`warning`,message:`Unsupported light type ${t}`,detail:a});let l=Bo(o,`inputs:enableColorTemperature`)?zo(o,`inputs:colorTemperature`):void 0,u=zo(o,`inputs:radius`),d=zo(o,`inputs:width`),f=zo(o,`inputs:height`),p=zo(o,`inputs:length`),m=zo(o,`inputs:angle`),h=Bo(o,`treatAsPoint`),g=Vo(o,`inputs:texture:file`),_=Vo(o,`inputs:texture:irradianceFile`),v=Vo(o,`inputs:shaping:ies:file`),y=zo(o,`inputs:shaping:cone:angle`),b=zo(o,`inputs:shaping:cone:softness`);g!==void 0&&n.sink?.({level:`info`,message:`Light texture referenced (not loaded) at ${a}`,detail:g}),v!==void 0&&n.sink?.({level:`info`,message:`IES profile referenced (not loaded) at ${a}`,detail:v}),i.push({path:a,type:c,usdType:t,color:Ho(o,`inputs:color`)??[1,1,1],intensity:zo(o,`inputs:intensity`)??1,exposure:zo(o,`inputs:exposure`)??0,normalize:Bo(o,`inputs:normalize`)??!1,...l===void 0?{}:{colorTemperature:l},...u===void 0?{}:{radius:u},...d===void 0?{}:{width:d},...f===void 0?{}:{height:f},...p===void 0?{}:{length:p},...m===void 0?{}:{angle:m},...h===void 0?{}:{treatAsPoint:h},...g===void 0?{}:{textureFile:g},...o.attributes.get(`inputs:texture:file`)?.sourceLayer===void 0?{}:{textureSourceLayer:o.attributes.get(`inputs:texture:file`).sourceLayer},..._===void 0?{}:{irradianceFile:_},...v===void 0?{}:{iesFile:v},...y===void 0?{}:{coneAngle:y},...b===void 0?{}:{coneSoftness:b},transform:r.get(a)??e})}return i}var Wo=class{maxBytes;maxConcurrency;dispose;diag;entries=new Map;pending=new Map;bytes=0;active=0;waiters=[];constructor(e){this.maxBytes=e.maxBytes,this.maxConcurrency=Math.max(1,e.maxConcurrency??4),this.dispose=e.dispose,this.diag=e.onDiagnostic??Cn}get byteSize(){return this.bytes}get count(){return this.entries.size}has(e){return this.entries.has(e)}async get(e,t,n={}){Tn(n.signal);let r=this.entries.get(e);if(r)return this.touch(e,r),r.value;let i=this.pending.get(e);if(!i){let n=new AbortController,r={promise:void 0,controller:n,refs:0};r.promise=this.runLoad(e,t,n),this.pending.set(e,r),i=r}return i.refs+=1,this.attach(e,i,n.signal)}delete(e){let t=this.entries.get(e);t&&(this.entries.delete(e),this.bytes-=t.size,this.dispose?.(t.value))}clear(){for(let[,e]of this.entries)this.dispose?.(e.value);this.entries.clear(),this.bytes=0}attach(e,t,n){return new Promise((r,i)=>{let a=!1,o=()=>{n&&n.removeEventListener(`abort`,c)},s=()=>{--t.refs,t.refs<=0&&this.pending.get(e)===t&&t.controller.abort()},c=()=>{a||(a=!0,o(),s(),i(new wn(`Asset load aborted.`)))};if(n){if(n.aborted){c();return}n.addEventListener(`abort`,c,{once:!0})}t.promise.then(e=>{a||(a=!0,o(),--t.refs,r(e))},e=>{a||(a=!0,o(),--t.refs,i(e))})})}async runLoad(e,t,n){await this.acquireSlot();try{let{value:r,size:i}=await t(n.signal);if(n.signal.aborted)throw this.dispose?.(r),new wn(`Asset load aborted.`);return this.pending.delete(e),this.insert(e,r,i),r}catch(t){throw this.pending.delete(e),t}finally{this.releaseSlot()}}insert(e,t,n){this.entries.set(e,{value:t,size:n}),this.bytes+=n,this.evictToBudget(e)}touch(e,t){this.entries.delete(e),this.entries.set(e,t)}evictToBudget(e){for(let[t,n]of this.entries){if(this.bytes<=this.maxBytes)break;t!==e&&(this.entries.delete(t),this.bytes-=n.size,this.dispose?.(n.value))}this.bytes>this.maxBytes&&this.diag({level:`warning`,message:`Asset exceeds cache budget and is retained alone: ${e} (${this.bytes} > ${this.maxBytes} bytes).`})}acquireSlot(){return this.active<this.maxConcurrency?(this.active+=1,Promise.resolve()):new Promise(e=>{this.waiters.push(()=>{this.active+=1,e()})})}releaseSlot(){--this.active;let e=this.waiters.shift();e&&e()}},Go=134217728,Ko=class{cache;constructor(e=Go){this.cache=new Wo({maxBytes:e,onDiagnostic:e=>console.warn(e.message)})}async get(e,t){let n=new URL(e);n.hash=``;let r=n.href,i=this.cache.has(r),a=performance.now(),o=await this.cache.get(r,async e=>{let n=await t(e);return{value:n,size:n.data.byteLength}});return performance.measure(`assets:texture-cache`,{start:a,end:performance.now(),detail:{hit:i,url:r,bytes:o.data.byteLength}}),o}};function qo(e,t){let n=e.length,r=``;for(let i=t.value;i<n;i++){let n=e[i];if(n===10)return t.value=i+1,r;r+=String.fromCharCode(n)}return t.value=n,r}function Jo(e){let t={value:0},n=qo(e,t);if(!/^#\?(RADIANCE|RGBE)/.test(n))throw Error(`Invalid HDR file: missing #?RADIANCE / #?RGBE magic`);let r=!1;for(;;){let n=qo(e,t);if(n===``)break;/^\s*FORMAT=32-bit_rle_rgbe/.test(n)&&(r=!0)}if(!r)throw Error(`Unsupported HDR format (expected 32-bit_rle_rgbe)`);let i=qo(e,t),a=/^-Y (\d+) \+X (\d+)/.exec(i);if(!a)throw Error(`Unsupported HDR resolution line: ${i}`);return{height:Number(a[1]),width:Number(a[2]),dataStart:t.value}}function Yo(e,t,n,r,i,a){if(r===0){i[a]=0,i[a+1]=0,i[a+2]=0;return}let o=2**(r-136);i[a]=e*o,i[a+1]=t*o,i[a+2]=n*o}function Xo(e){let{width:t,height:n,dataStart:r}=Jo(e),i=new Float32Array(t*n*3),a=t>=8&&t<32768,o=r,s=new Uint8Array(t*4);for(let r=0;r<n;r++){let n=!a;if(a){let a=e[o],c=e[o+1],l=e[o+2],u=e[o+3];if(a!==2||c!==2||l&128||(l<<8|u)!==t)n=!0;else{o+=4;for(let n=0;n<4;n++){let r=0;for(;r<t;){let t=e[o++];if(t>128){let i=e[o++];for(t-=128;t-->0;)s[r++*4+n]=i}else for(;t-->0;)s[r++*4+n]=e[o++]}}let n=r*t*3;for(let e=0;e<t;e++){let t=e*4;Yo(s[t],s[t+1],s[t+2],s[t+3],i,n+e*3)}}}if(n){let n=r*t*3;for(let r=0;r<t;r++)Yo(e[o],e[o+1],e[o+2],e[o+3],i,n+r*3),o+=4}}return{width:t,height:n,data:i}}function Zo(e,t,n){return[.282095,.488603*t,.488603*n,.488603*e,1.092548*e*t,1.092548*t*n,.315392*(3*n*n-1),1.092548*e*n,.546274*(e*e-t*t)]}function Qo(e){let t=Math.min(e.width,256),n=Math.min(e.height,128);return{cols:t,rows:n,stepX:e.width/t,stepY:e.height/n}}function $o(e,t,n){let r=Math.min(e.width-1,Math.max(0,Math.floor(t))),i=(Math.min(e.height-1,Math.max(0,Math.floor(n)))*e.width+r)*3;return[e.data[i],e.data[i+1],e.data[i+2]]}function es(e){let t=new Float32Array(27),{cols:n,rows:r,stepX:i,stepY:a}=Qo(e),o=0;for(let s=0;s<r;s++){let c=(s+.5)/r*Math.PI,l=Math.sin(c),u=Math.cos(c),d=l;for(let r=0;r<n;r++){let c=((r+.5)/n-.5)*2*Math.PI,f=Zo(l*Math.cos(c),u,l*Math.sin(c)),p=$o(e,r*i,s*a);for(let e=0;e<9;e++){let n=f[e]*d;t[e*3]=t[e*3]+p[0]*n,t[e*3+1]=t[e*3+1]+p[1]*n,t[e*3+2]=t[e*3+2]+p[2]*n}o+=d}}let s=4*Math.PI/o;for(let e=0;e<27;e++)t[e]*=s;return t}function ts(e){let{cols:t,rows:n,stepX:r,stepY:i}=Qo(e),a=[0,0,0],o=0;for(let s=0;s<n;s++){let c=(s+.5)/n*Math.PI,l=Math.sin(c);for(let n=0;n<t;n++){let t=$o(e,n*r,s*i);a[0]+=t[0]*l,a[1]+=t[1]*l,a[2]+=t[2]*l,o+=l}}return o>0?[a[0]/o,a[1]/o,a[2]/o]:[0,0,0]}var ns=[[`diffuseColor`,`color3`],[`emissiveColor`,`color3`],[`specularColor`,`color3`],[`metallic`,`float`],[`roughness`,`float`],[`clearcoat`,`float`],[`clearcoatRoughness`,`float`],[`opacity`,`float`],[`ior`,`float`],[`normal`,`vector3`]];function rs(e,t){return e.attributes.get(t)?.value}function is(e,t){let n=rs(e,t);return typeof n==`string`?n:void 0}function as(e){return is(e,`info:id`)}function os(e){let t=e.indexOf(`.`);if(t<0)return{nodePath:e,output:``};let n=e.slice(0,t),r=e.slice(t+1),i=r.lastIndexOf(`:`);return{nodePath:n,output:i>=0?r.slice(i+1):r}}function ss(e,t){let n=e.attributes.get(`inputs:${t}.connect`)?.value;if(typeof n==`string`&&n.length>0)return{connection:os(n)};let r=e.attributes.get(`inputs:${t}`)?.value;if(r!==void 0)return{value:r}}function cs(e,t){for(let[n,r]of t.attributes)if(n.startsWith(`outputs:`)&&n.endsWith(`surface.connect`)&&typeof r.value==`string`){let t=e.prims.get(os(r.value).nodePath);if(t&&as(t)===`UsdPreviewSurface`)return t}for(let n of t.children){let t=e.prims.get(n);if(t&&as(t)===`UsdPreviewSurface`)return t}}function ls(e){return e.startsWith(`./`)?e.slice(2):e}function us(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function ds(e,t){if(typeof e==`number`)return String(e);if(typeof e==`boolean`)return e?`true`:`false`;if(Array.isArray(e)){let n=e;if(t===`color3`||t===`vector3`){let e=Number(n[0]??0);return[0,1,2].map(t=>Number(n[t]??e)).join(`, `)}return n.map(e=>String(e)).join(`, `)}return String(e)}function fs(e,t,n){let r=cs(e,t);if(!r)return;let i=t.name,a=`Surface`,o=new Map,s=[],c=[],l=[],u=()=>(l.length||l.push(`  <texcoord name="st_raw" type="vector2" />`),`st_raw`),d=(e,t,r)=>{let i=is(e,`inputs:file`);if(!i){n(`warning`,`UsdUVTexture ${e.path} has no inputs:file`);return}let a=t===`r`||t===`g`||t===`b`||t===`a`?`float`:r,c=`${e.path}|${t}`,l=o.get(c);if(l)return l.name;let d=`img_${o.size}_${e.name}`,f=ls(i);s.includes(f)||s.push(f);let p=u(),m=`  <image name="${us(d)}" type="${a}">\n    <input name="file" type="filename" value="${us(f)}" />\n    <input name="texcoord" type="vector2" nodename="${p}" />\n  </image>`;return o.set(c,{xml:m,name:d}),d};for(let[t,i]of ns){let a=ss(r,t);if(a){if(a.connection){let o=e.prims.get(a.connection.nodePath);if(!o||as(o)!==`UsdUVTexture`){n(`info`,`UsdPreviewSurface ${r.path}.${t} drives unsupported node; skipped`);continue}let s=d(o,a.connection.output,i);s&&c.push(`    <input name="${t}" type="${i}" nodename="${us(s)}" />`)}else a.value!==void 0&&c.push(`    <input name="${t}" type="${i}" value="${us(ds(a.value,i))}" />`)}}if(o.size===0&&c.length===0)return;let f=[...o.values()].map(e=>e.xml).join(`
`),p=l.join(`
`),m=`<?xml version="1.0"?>
<materialx version="1.38" colorspace="lin_rec709">
`+(p?p+`
`:``)+(f?f+`
`:``)+`  <UsdPreviewSurface name="${a}" type="surfaceshader">\n`+c.join(`
`)+(c.length?`
`:``)+`  </UsdPreviewSurface>\n  <surfacematerial name="${us(i)}" type="material">\n    <input name="surfaceshader" type="surfaceshader" nodename="${a}" />\n  </surfacematerial>\n</materialx>\n`;return{reference:{primPath:t.path,assetPath:`usdpreview:${t.path}`,referencedPrimPath:t.path,materialName:i},xml:m,textureFiles:s}}function ps(e,t){let n=(e,n)=>t?.({level:e,message:n}),r=new Set(e.materials.map(e=>e.primPath)),i=[];for(let t of e.prims.values()){if(t.typeName!==`Material`||r.has(t.path))continue;let a=fs(e,t,n);a&&i.push(a)}return i}var ms=`attached`,hs=1e3,gs=1001,_s=1002,vs=1003,ys=1004,bs=1005,xs=1006,Ss=1007,Cs=1008,ws=1009,Ts=1015,Es=1016,Ds=1023,Os=1028,ks=1030,As=2300,js=2301,Ms=2302,Ns=2303,Ps=2400,Fs=2401,Is=2402,Ls=2500,Rs=`srgb`,zs=`srgb-linear`,Bs=`linear`,Vs=`srgb`,Hs=7680,Us=35044,Ws=2e3;function Gs(e){for(let t=e.length-1;t>=0;--t)if(e[t]>=65535)return!0;return!1}function Ks(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function qs(e){return document.createElementNS(`http://www.w3.org/1999/xhtml`,e)}var Js={};function Ys(...e){let t=`THREE.`+e.shift();console.log(t,...e)}function Xs(e){let t=e[0];if(typeof t==`string`&&t.startsWith(`TSL:`)){let t=e[1];t&&t.isStackTrace?e[0]+=` `+t.getLocation():e[1]=`Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.`}return e}function H(...e){e=Xs(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.warn(n.getError(t)):console.warn(t,...e)}}function U(...e){e=Xs(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.error(n.getError(t)):console.error(t,...e)}}function Zs(...e){let t=e.join(` `);t in Js||(Js[t]=!0,H(...e))}var Qs=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n!==void 0&&n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let r=n[e];if(r!==void 0){let e=r.indexOf(t);e!==-1&&r.splice(e,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let t=n.slice(0);for(let n=0,r=t.length;n<r;n++)t[n].call(this,e);e.target=null}}},$s=`00.01.02.03.04.05.06.07.08.09.0a.0b.0c.0d.0e.0f.10.11.12.13.14.15.16.17.18.19.1a.1b.1c.1d.1e.1f.20.21.22.23.24.25.26.27.28.29.2a.2b.2c.2d.2e.2f.30.31.32.33.34.35.36.37.38.39.3a.3b.3c.3d.3e.3f.40.41.42.43.44.45.46.47.48.49.4a.4b.4c.4d.4e.4f.50.51.52.53.54.55.56.57.58.59.5a.5b.5c.5d.5e.5f.60.61.62.63.64.65.66.67.68.69.6a.6b.6c.6d.6e.6f.70.71.72.73.74.75.76.77.78.79.7a.7b.7c.7d.7e.7f.80.81.82.83.84.85.86.87.88.89.8a.8b.8c.8d.8e.8f.90.91.92.93.94.95.96.97.98.99.9a.9b.9c.9d.9e.9f.a0.a1.a2.a3.a4.a5.a6.a7.a8.a9.aa.ab.ac.ad.ae.af.b0.b1.b2.b3.b4.b5.b6.b7.b8.b9.ba.bb.bc.bd.be.bf.c0.c1.c2.c3.c4.c5.c6.c7.c8.c9.ca.cb.cc.cd.ce.cf.d0.d1.d2.d3.d4.d5.d6.d7.d8.d9.da.db.dc.dd.de.df.e0.e1.e2.e3.e4.e5.e6.e7.e8.e9.ea.eb.ec.ed.ee.ef.f0.f1.f2.f3.f4.f5.f6.f7.f8.f9.fa.fb.fc.fd.fe.ff`.split(`.`),ec=1234567,tc=Math.PI/180,nc=180/Math.PI;function rc(){let e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0,r=Math.random()*4294967295|0;return($s[e&255]+$s[e>>8&255]+$s[e>>16&255]+$s[e>>24&255]+`-`+$s[t&255]+$s[t>>8&255]+`-`+$s[t>>16&15|64]+$s[t>>24&255]+`-`+$s[n&63|128]+$s[n>>8&255]+`-`+$s[n>>16&255]+$s[n>>24&255]+$s[r&255]+$s[r>>8&255]+$s[r>>16&255]+$s[r>>24&255]).toLowerCase()}function W(e,t,n){return Math.max(t,Math.min(n,e))}function ic(e,t){return(e%t+t)%t}function ac(e,t,n,r,i){return r+(e-t)*(i-r)/(n-t)}function oc(e,t,n){return e===t?0:(n-e)/(t-e)}function sc(e,t,n){return(1-n)*e+n*t}function cc(e,t,n,r){return sc(e,t,1-Math.exp(-n*r))}function lc(e,t=1){return t-Math.abs(ic(e,t*2)-t)}function uc(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*(3-2*e))}function dc(e,t,n){return e<=t?0:e>=n?1:(e=(e-t)/(n-t),e*e*e*(e*(e*6-15)+10))}function fc(e,t){return e+Math.floor(Math.random()*(t-e+1))}function pc(e,t){return e+Math.random()*(t-e)}function mc(e){return e*(.5-Math.random())}function hc(e){e!==void 0&&(ec=e);let t=ec+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function gc(e){return e*tc}function _c(e){return e*nc}function vc(e){return e>0&&Number.isInteger(e)&&2**Math.round(Math.log2(e))===e}function yc(e){return 2**Math.ceil(Math.log(e)/Math.LN2)}function bc(e){return 2**Math.floor(Math.log(e)/Math.LN2)}function xc(e,t,n,r,i){let a=Math.cos,o=Math.sin,s=a(n/2),c=o(n/2),l=a((t+r)/2),u=o((t+r)/2),d=a((t-r)/2),f=o((t-r)/2),p=a((r-t)/2),m=o((r-t)/2);switch(i){case`XYX`:e.set(s*u,c*d,c*f,s*l);break;case`YZY`:e.set(c*f,s*u,c*d,s*l);break;case`ZXZ`:e.set(c*d,c*f,s*u,s*l);break;case`XZX`:e.set(s*u,c*m,c*p,s*l);break;case`YXY`:e.set(c*p,s*u,c*m,s*l);break;case`ZYZ`:e.set(c*m,c*p,s*u,s*l);break;default:H(`MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: `+i)}}function Sc(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return e/4294967295;case Uint16Array:return e/65535;case Uint8Array:case Uint8ClampedArray:return e/255;case Int32Array:return Math.max(e/2147483647,-1);case Int16Array:return Math.max(e/32767,-1);case Int8Array:return Math.max(e/127,-1);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}function G(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return Math.round(e*4294967295);case Uint16Array:return Math.round(e*65535);case Uint8Array:case Uint8ClampedArray:return Math.round(e*255);case Int32Array:return Math.round(e*2147483647);case Int16Array:return Math.round(e*32767);case Int8Array:return Math.round(e*127);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}var Cc={DEG2RAD:tc,RAD2DEG:nc,generateUUID:rc,clamp:W,euclideanModulo:ic,mapLinear:ac,inverseLerp:oc,lerp:sc,damp:cc,pingpong:lc,smoothstep:uc,smootherstep:dc,randInt:fc,randFloat:pc,randFloatSpread:mc,seededRandom:hc,degToRad:gc,radToDeg:_c,isPowerOfTwo:vc,ceilPowerOfTwo:yc,floorPowerOfTwo:bc,setQuaternionFromProperEuler:xc,normalize:G,denormalize:Sc},K=class e{static{e.prototype.isVector2=!0}constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw Error(`THREE.Vector2: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw Error(`THREE.Vector2: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6],this.y=r[1]*t+r[4]*n+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=W(this.x,e.x,t.x),this.y=W(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=W(this.x,e,t),this.y=W(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(W(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(W(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),r=Math.sin(t),i=this.x-e.x,a=this.y-e.y;return this.x=i*n-a*r+e.x,this.y=i*r+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},wc=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,i,a,o){let s=n[r+0],c=n[r+1],l=n[r+2],u=n[r+3],d=i[a+0],f=i[a+1],p=i[a+2],m=i[a+3];if(u!==m||s!==d||c!==f||l!==p){let e=s*d+c*f+l*p+u*m;e<0&&(d=-d,f=-f,p=-p,m=-m,e=-e);let t=1-o;if(e<.9995){let n=Math.acos(e),r=Math.sin(n);t=Math.sin(t*n)/r,o=Math.sin(o*n)/r,s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o}else{s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o;let e=1/Math.sqrt(s*s+c*c+l*l+u*u);s*=e,c*=e,l*=e,u*=e}}e[t]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,i,a){let o=n[r],s=n[r+1],c=n[r+2],l=n[r+3],u=i[a],d=i[a+1],f=i[a+2],p=i[a+3];return e[t]=o*p+l*u+s*f-c*d,e[t+1]=s*p+l*d+c*u-o*f,e[t+2]=c*p+l*f+o*d-s*u,e[t+3]=l*p-o*u-s*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,i=e._z,a=e._order,o=Math.cos,s=Math.sin,c=o(n/2),l=o(r/2),u=o(i/2),d=s(n/2),f=s(r/2),p=s(i/2);switch(a){case`XYZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`YXZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`ZXY`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`ZYX`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`YZX`:this._x=d*l*u+c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u-d*f*p;break;case`XZY`:this._x=d*l*u-c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u+d*f*p;break;default:H(`Quaternion: .setFromEuler() encountered an unknown order: `+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],i=t[8],a=t[1],o=t[5],s=t[9],c=t[2],l=t[6],u=t[10],d=n+o+u;if(d>0){let e=.5/Math.sqrt(d+1);this._w=.25/e,this._x=(l-s)*e,this._y=(i-c)*e,this._z=(a-r)*e}else if(n>o&&n>u){let e=2*Math.sqrt(1+n-o-u);this._w=(l-s)/e,this._x=.25*e,this._y=(r+a)/e,this._z=(i+c)/e}else if(o>u){let e=2*Math.sqrt(1+o-n-u);this._w=(i-c)/e,this._x=(r+a)/e,this._y=.25*e,this._z=(s+l)/e}else{let e=2*Math.sqrt(1+u-n-o);this._w=(a-r)/e,this._x=(i+c)/e,this._y=(s+l)/e,this._z=.25*e}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(W(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x*=e,this._y*=e,this._z*=e,this._w*=e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=t._x,s=t._y,c=t._z,l=t._w;return this._x=n*l+a*o+r*c-i*s,this._y=r*l+a*s+i*o-n*c,this._z=i*l+a*c+n*s-r*o,this._w=a*l-n*o-r*s-i*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,r=-r,i=-i,a=-a,o=-o);let s=1-t;if(o<.9995){let e=Math.acos(o),c=Math.sin(e);s=Math.sin(s*e)/c,t=Math.sin(t*e)/c,this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this._onChangeCallback()}else this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),i=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),i*Math.sin(t),i*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},q=class e{static{e.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw Error(`THREE.Vector3: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error(`THREE.Vector3: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Ec.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Ec.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6]*r,this.y=i[1]*t+i[4]*n+i[7]*r,this.z=i[2]*t+i[5]*n+i[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=e.elements,a=1/(i[3]*t+i[7]*n+i[11]*r+i[15]);return this.x=(i[0]*t+i[4]*n+i[8]*r+i[12])*a,this.y=(i[1]*t+i[5]*n+i[9]*r+i[13])*a,this.z=(i[2]*t+i[6]*n+i[10]*r+i[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,i=e.x,a=e.y,o=e.z,s=e.w,c=2*(a*r-o*n),l=2*(o*t-i*r),u=2*(i*n-a*t);return this.x=t+s*c+a*u-o*l,this.y=n+s*l+o*c-i*u,this.z=r+s*u+i*l-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[4]*n+i[8]*r,this.y=i[1]*t+i[5]*n+i[9]*r,this.z=i[2]*t+i[6]*n+i[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=W(this.x,e.x,t.x),this.y=W(this.y,e.y,t.y),this.z=W(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=W(this.x,e,t),this.y=W(this.y,e,t),this.z=W(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(W(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,i=e.z,a=t.x,o=t.y,s=t.z;return this.x=r*s-i*o,this.y=i*a-n*s,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Tc.copy(this).projectOnVector(e),this.sub(Tc)}reflect(e){return this.sub(Tc.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(W(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},Tc=new q,Ec=new wc,Dc=class e{static{e.prototype.isMatrix3=!0}constructor(e,t,n,r,i,a,o,s,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c)}set(e,t,n,r,i,a,o,s,c){let l=this.elements;return l[0]=e,l[1]=r,l[2]=o,l[3]=t,l[4]=i,l[5]=s,l[6]=n,l[7]=a,l[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[3],s=n[6],c=n[1],l=n[4],u=n[7],d=n[2],f=n[5],p=n[8],m=r[0],h=r[3],g=r[6],_=r[1],v=r[4],y=r[7],b=r[2],x=r[5],S=r[8];return i[0]=a*m+o*_+s*b,i[3]=a*h+o*v+s*x,i[6]=a*g+o*y+s*S,i[1]=c*m+l*_+u*b,i[4]=c*h+l*v+u*x,i[7]=c*g+l*y+u*S,i[2]=d*m+f*_+p*b,i[5]=d*h+f*v+p*x,i[8]=d*g+f*y+p*S,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8];return t*a*l-t*o*c-n*i*l+n*o*s+r*i*c-r*a*s}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=l*a-o*c,d=o*s-l*i,f=c*i-a*s,p=t*u+n*d+r*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/p;return e[0]=u*m,e[1]=(r*c-l*n)*m,e[2]=(o*n-r*a)*m,e[3]=d*m,e[4]=(l*t-r*s)*m,e[5]=(r*i-o*t)*m,e[6]=f*m,e[7]=(n*s-c*t)*m,e[8]=(a*t-n*i)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,i,a,o){let s=Math.cos(i),c=Math.sin(i);return this.set(n*s,n*c,-n*(s*a+c*o)+a+e,-r*c,r*s,-r*(-c*a+s*o)+o+t,0,0,1),this}scale(e,t){return Zs(`Matrix3: .scale() is deprecated. Use .makeScale() instead.`),this.premultiply(Oc.makeScale(e,t)),this}rotate(e){return Zs(`Matrix3: .rotate() is deprecated. Use .makeRotation() instead.`),this.premultiply(Oc.makeRotation(-e)),this}translate(e,t){return Zs(`Matrix3: .translate() is deprecated. Use .makeTranslation() instead.`),this.premultiply(Oc.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<9;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},Oc=new Dc,kc=new Dc().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Ac=new Dc().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function jc(){let e={enabled:!0,workingColorSpace:zs,spaces:{},convert:function(e,t,n){return this.enabled===!1||t===n||!t||!n||(this.spaces[t].transfer===`srgb`&&(e.r=Nc(e.r),e.g=Nc(e.g),e.b=Nc(e.b)),this.spaces[t].primaries!==this.spaces[n].primaries&&(e.applyMatrix3(this.spaces[t].toXYZ),e.applyMatrix3(this.spaces[n].fromXYZ)),this.spaces[n].transfer===`srgb`&&(e.r=Pc(e.r),e.g=Pc(e.g),e.b=Pc(e.b))),e},workingToColorSpace:function(e,t){return this.convert(e,this.workingColorSpace,t)},colorSpaceToWorking:function(e,t){return this.convert(e,t,this.workingColorSpace)},getPrimaries:function(e){return this.spaces[e].primaries},getTransfer:function(e){return e===``?Bs:this.spaces[e].transfer},getToneMappingMode:function(e){return this.spaces[e].outputColorSpaceConfig.toneMappingMode||`standard`},getLuminanceCoefficients:function(e,t=this.workingColorSpace){return e.fromArray(this.spaces[t].luminanceCoefficients)},define:function(e){Object.assign(this.spaces,e)},_getMatrix:function(e,t,n){return e.copy(this.spaces[t].toXYZ).multiply(this.spaces[n].fromXYZ)},_getDrawingBufferColorSpace:function(e){return this.spaces[e].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(e=this.workingColorSpace){return this.spaces[e].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(t,n){return Zs(`ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace().`),e.workingToColorSpace(t,n)},toWorkingColorSpace:function(t,n){return Zs(`ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking().`),e.colorSpaceToWorking(t,n)}},t=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],r=[.3127,.329];return e.define({[zs]:{primaries:t,whitePoint:r,transfer:Bs,toXYZ:kc,fromXYZ:Ac,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Rs},outputColorSpaceConfig:{drawingBufferColorSpace:Rs}},[Rs]:{primaries:t,whitePoint:r,transfer:Vs,toXYZ:kc,fromXYZ:Ac,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Rs}}}),e}var Mc=jc();function Nc(e){return e<.04045?e*.0773993808:(e*.9478672986+.0521327014)**2.4}function Pc(e){return e<.0031308?e*12.92:1.055*e**.41666-.055}var Fc,Ic=class{static getDataURL(e,t=`image/png`){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>`u`)return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Fc===void 0&&(Fc=qs(`canvas`)),Fc.width=e.width,Fc.height=e.height;let t=Fc.getContext(`2d`);e instanceof ImageData?t.putImageData(e,0,0):t.drawImage(e,0,0,e.width,e.height),n=Fc}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap){let t=qs(`canvas`);t.width=e.width,t.height=e.height;let n=t.getContext(`2d`);n.drawImage(e,0,0,e.width,e.height);let r=n.getImageData(0,0,e.width,e.height),i=r.data;for(let e=0;e<i.length;e++)i[e]=Nc(i[e]/255)*255;return n.putImageData(r,0,0),t}if(e.data){let t=e.data.slice(0);for(let e=0;e<t.length;e++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[e]=Math.floor(Nc(t[e]/255)*255):t[e]=Nc(t[e]);return{data:t,width:e.width,height:e.height}}return H(`ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied.`),e}},Lc=0,Rc=class{constructor(e=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:Lc++}),this.uuid=rc(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<`u`&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<`u`&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t===null?e.set(0,0,0):e.set(t.width,t.height,t.depth||0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:``},r=this.data;if(r!==null){let e;if(Array.isArray(r)){e=[];for(let t=0,n=r.length;t<n;t++)r[t].isDataTexture?e.push(zc(r[t].image)):e.push(zc(r[t]))}else e=zc(r);n.url=e}return t||(e.images[this.uuid]=n),n}};function zc(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap?Ic.getDataURL(e):e.data?{data:Array.from(e.data),width:e.width,height:e.height,type:e.data.constructor.name}:(H(`Texture: Unable to serialize Texture.`),{})}var Bc=0,Vc=new q,Hc=class e extends Qs{constructor(t=e.DEFAULT_IMAGE,n=e.DEFAULT_MAPPING,r=gs,i=gs,a=xs,o=Cs,s=Ds,c=ws,l=e.DEFAULT_ANISOTROPY,u=``){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Bc++}),this.uuid=rc(),this.name=``,this.source=new Rc(t),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=r,this.wrapT=i,this.magFilter=a,this.minFilter=o,this.anisotropy=l,this.format=s,this.internalFormat=null,this.type=c,this.offset=new K(0,0),this.repeat=new K(1,1),this.center=new K(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Dc,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Vc).x}get height(){return this.source.getSize(Vc).y}get depth(){return this.source.getSize(Vc).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){H(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let r=this[t];r===void 0?H(`Texture.setValues(): property '${t}' does not exist.`):r&&n&&r.isVector2&&n.isVector2||r&&n&&r.isVector3&&n.isVector3||r&&n&&r.isMatrix3&&n.isMatrix3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:`Texture`,generator:`Texture.toJSON`},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:`dispose`})}transformUv(e){if(this.mapping!==300)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case hs:e.x-=Math.floor(e.x);break;case gs:e.x=e.x<0?0:1;break;case _s:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x-=Math.floor(e.x)}if(e.y<0||e.y>1)switch(this.wrapT){case hs:e.y-=Math.floor(e.y);break;case gs:e.y=e.y<0?0:1;break;case _s:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y-=Math.floor(e.y)}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Hc.DEFAULT_IMAGE=null,Hc.DEFAULT_MAPPING=300,Hc.DEFAULT_ANISOTROPY=1;var Uc=class e{static{e.prototype.isVector4=!0}constructor(e=0,t=0,n=0,r=1){this.x=e,this.y=t,this.z=n,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw Error(`THREE.Vector4: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error(`THREE.Vector4: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w===void 0?1:e.w,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*i,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*i,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*i,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*i,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,i,a=.01,o=.1,s=e.elements,c=s[0],l=s[4],u=s[8],d=s[1],f=s[5],p=s[9],m=s[2],h=s[6],g=s[10];if(Math.abs(l-d)<a&&Math.abs(u-m)<a&&Math.abs(p-h)<a){if(Math.abs(l+d)<o&&Math.abs(u+m)<o&&Math.abs(p+h)<o&&Math.abs(c+f+g-3)<o)return this.set(1,0,0,0),this;t=Math.PI;let e=(c+1)/2,s=(f+1)/2,_=(g+1)/2,v=(l+d)/4,y=(u+m)/4,b=(p+h)/4;return e>s&&e>_?e<a?(n=0,r=.707106781,i=.707106781):(n=Math.sqrt(e),r=v/n,i=y/n):s>_?s<a?(n=.707106781,r=0,i=.707106781):(r=Math.sqrt(s),n=v/r,i=b/r):_<a?(n=.707106781,r=.707106781,i=0):(i=Math.sqrt(_),n=y/i,r=b/i),this.set(n,r,i,t),this}let _=Math.sqrt((h-p)*(h-p)+(u-m)*(u-m)+(d-l)*(d-l));return Math.abs(_)<.001&&(_=1),this.x=(h-p)/_,this.y=(u-m)/_,this.z=(d-l)/_,this.w=Math.acos((c+f+g-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=W(this.x,e.x,t.x),this.y=W(this.y,e.y,t.y),this.z=W(this.z,e.z,t.z),this.w=W(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=W(this.x,e,t),this.y=W(this.y,e,t),this.z=W(this.z,e,t),this.w=W(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(W(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},J=class e{static{e.prototype.isMatrix4=!0}constructor(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h)}set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){let g=this.elements;return g[0]=e,g[4]=t,g[8]=n,g[12]=r,g[1]=i,g[5]=a,g[9]=o,g[13]=s,g[2]=c,g[6]=l,g[10]=u,g[14]=d,g[3]=f,g[7]=p,g[11]=m,g[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,r=1/Wc.setFromMatrixColumn(e,0).length(),i=1/Wc.setFromMatrixColumn(e,1).length(),a=1/Wc.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*i,t[5]=n[5]*i,t[6]=n[6]*i,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,i=e.z,a=Math.cos(n),o=Math.sin(n),s=Math.cos(r),c=Math.sin(r),l=Math.cos(i),u=Math.sin(i);if(e.order===`XYZ`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=-s*u,t[8]=c,t[1]=n+r*c,t[5]=e-i*c,t[9]=-o*s,t[2]=i-e*c,t[6]=r+n*c,t[10]=a*s}else if(e.order===`YXZ`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e+i*o,t[4]=r*o-n,t[8]=a*c,t[1]=a*u,t[5]=a*l,t[9]=-o,t[2]=n*o-r,t[6]=i+e*o,t[10]=a*s}else if(e.order===`ZXY`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e-i*o,t[4]=-a*u,t[8]=r+n*o,t[1]=n+r*o,t[5]=a*l,t[9]=i-e*o,t[2]=-a*c,t[6]=o,t[10]=a*s}else if(e.order===`ZYX`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=r*c-n,t[8]=e*c+i,t[1]=s*u,t[5]=i*c+e,t[9]=n*c-r,t[2]=-c,t[6]=o*s,t[10]=a*s}else if(e.order===`YZX`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=i-e*u,t[8]=r*u+n,t[1]=u,t[5]=a*l,t[9]=-o*l,t[2]=-c*l,t[6]=n*u+r,t[10]=e-i*u}else if(e.order===`XZY`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=-u,t[8]=c*l,t[1]=e*u+i,t[5]=a*l,t[9]=n*u-r,t[2]=r*u-n,t[6]=o*l,t[10]=i*u+e}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Kc,e,qc)}lookAt(e,t,n){let r=this.elements;return Xc.subVectors(e,t),Xc.lengthSq()===0&&(Xc.z=1),Xc.normalize(),Jc.crossVectors(n,Xc),Jc.lengthSq()===0&&(Math.abs(n.z)===1?Xc.x+=1e-4:Xc.z+=1e-4,Xc.normalize(),Jc.crossVectors(n,Xc)),Jc.normalize(),Yc.crossVectors(Xc,Jc),r[0]=Jc.x,r[4]=Yc.x,r[8]=Xc.x,r[1]=Jc.y,r[5]=Yc.y,r[9]=Xc.y,r[2]=Jc.z,r[6]=Yc.z,r[10]=Xc.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[4],s=n[8],c=n[12],l=n[1],u=n[5],d=n[9],f=n[13],p=n[2],m=n[6],h=n[10],g=n[14],_=n[3],v=n[7],y=n[11],b=n[15],x=r[0],S=r[4],C=r[8],w=r[12],T=r[1],E=r[5],D=r[9],O=r[13],k=r[2],A=r[6],j=r[10],M=r[14],ee=r[3],te=r[7],ne=r[11],re=r[15];return i[0]=a*x+o*T+s*k+c*ee,i[4]=a*S+o*E+s*A+c*te,i[8]=a*C+o*D+s*j+c*ne,i[12]=a*w+o*O+s*M+c*re,i[1]=l*x+u*T+d*k+f*ee,i[5]=l*S+u*E+d*A+f*te,i[9]=l*C+u*D+d*j+f*ne,i[13]=l*w+u*O+d*M+f*re,i[2]=p*x+m*T+h*k+g*ee,i[6]=p*S+m*E+h*A+g*te,i[10]=p*C+m*D+h*j+g*ne,i[14]=p*w+m*O+h*M+g*re,i[3]=_*x+v*T+y*k+b*ee,i[7]=_*S+v*E+y*A+b*te,i[11]=_*C+v*D+y*j+b*ne,i[15]=_*w+v*O+y*M+b*re,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[12],a=e[1],o=e[5],s=e[9],c=e[13],l=e[2],u=e[6],d=e[10],f=e[14],p=e[3],m=e[7],h=e[11],g=e[15],_=s*f-c*d,v=o*f-c*u,y=o*d-s*u,b=a*f-c*l,x=a*d-s*l,S=a*u-o*l;return t*(m*_-h*v+g*y)-n*(p*_-h*b+g*x)+r*(p*v-m*b+g*S)-i*(p*y-m*x+h*S)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[1],a=e[5],o=e[9],s=e[2],c=e[6],l=e[10];return t*(a*l-o*c)-n*(i*l-o*s)+r*(i*c-a*s)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=e[9],d=e[10],f=e[11],p=e[12],m=e[13],h=e[14],g=e[15],_=t*o-n*a,v=t*s-r*a,y=t*c-i*a,b=n*s-r*o,x=n*c-i*o,S=r*c-i*s,C=l*m-u*p,w=l*h-d*p,T=l*g-f*p,E=u*h-d*m,D=u*g-f*m,O=d*g-f*h,k=_*O-v*D+y*E+b*T-x*w+S*C;if(k===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let A=1/k;return e[0]=(o*O-s*D+c*E)*A,e[1]=(r*D-n*O-i*E)*A,e[2]=(m*S-h*x+g*b)*A,e[3]=(d*x-u*S-f*b)*A,e[4]=(s*T-a*O-c*w)*A,e[5]=(t*O-r*T+i*w)*A,e[6]=(h*y-p*S-g*v)*A,e[7]=(l*S-d*y+f*v)*A,e[8]=(a*D-o*T+c*C)*A,e[9]=(n*T-t*D-i*C)*A,e[10]=(p*x-m*y+g*_)*A,e[11]=(u*y-l*x-f*_)*A,e[12]=(o*w-a*E-s*C)*A,e[13]=(t*E-n*w+r*C)*A,e[14]=(m*v-p*b-h*_)*A,e[15]=(l*b-u*v+d*_)*A,this}scale(e){let t=this.elements,n=e.x,r=e.y,i=e.z;return t[0]*=n,t[4]*=r,t[8]*=i,t[1]*=n,t[5]*=r,t[9]*=i,t[2]*=n,t[6]*=r,t[10]*=i,t[3]*=n,t[7]*=r,t[11]*=i,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),i=1-n,a=e.x,o=e.y,s=e.z,c=i*a,l=i*o;return this.set(c*a+n,c*o-r*s,c*s+r*o,0,c*o+r*s,l*o+n,l*s-r*a,0,c*s-r*o,l*s+r*a,i*s*s+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,i,a){return this.set(1,n,i,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,i=t._x,a=t._y,o=t._z,s=t._w,c=i+i,l=a+a,u=o+o,d=i*c,f=i*l,p=i*u,m=a*l,h=a*u,g=o*u,_=s*c,v=s*l,y=s*u,b=n.x,x=n.y,S=n.z;return r[0]=(1-(m+g))*b,r[1]=(f+y)*b,r[2]=(p-v)*b,r[3]=0,r[4]=(f-y)*x,r[5]=(1-(d+g))*x,r[6]=(h+_)*x,r[7]=0,r[8]=(p+v)*S,r[9]=(h-_)*S,r[10]=(1-(d+m))*S,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let i=this.determinantAffine();if(i===0)return n.set(1,1,1),t.identity(),this;let a=Wc.set(r[0],r[1],r[2]).length(),o=Wc.set(r[4],r[5],r[6]).length(),s=Wc.set(r[8],r[9],r[10]).length();i<0&&(a=-a),Gc.copy(this);let c=1/a,l=1/o,u=1/s;return Gc.elements[0]*=c,Gc.elements[1]*=c,Gc.elements[2]*=c,Gc.elements[4]*=l,Gc.elements[5]*=l,Gc.elements[6]*=l,Gc.elements[8]*=u,Gc.elements[9]*=u,Gc.elements[10]*=u,t.setFromRotationMatrix(Gc),n.x=a,n.y=o,n.z=s,this}makePerspective(e,t,n,r,i,a,o=Ws,s=!1){let c=this.elements,l=2*i/(t-e),u=2*i/(n-r),d=(t+e)/(t-e),f=(n+r)/(n-r),p,m;if(s)p=i/(a-i),m=a*i/(a-i);else if(o===2e3)p=-(a+i)/(a-i),m=-2*a*i/(a-i);else if(o===2001)p=-a/(a-i),m=-a*i/(a-i);else throw Error(`THREE.Matrix4.makePerspective(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,r,i,a,o=Ws,s=!1){let c=this.elements,l=2/(t-e),u=2/(n-r),d=-(t+e)/(t-e),f=-(n+r)/(n-r),p,m;if(s)p=1/(a-i),m=a/(a-i);else if(o===2e3)p=-2/(a-i),m=-(a+i)/(a-i);else if(o===2001)p=-1/(a-i),m=-i/(a-i);else throw Error(`THREE.Matrix4.makeOrthographic(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<16;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},Wc=new q,Gc=new J,Kc=new q(0,0,0),qc=new q(1,1,1),Jc=new q,Yc=new q,Xc=new q,Zc=new J,Qc=new wc,$c=class e{constructor(t=0,n=0,r=0,i=e.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=n,this._z=r,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,r=this._order){return this._x=e,this._y=t,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let r=e.elements,i=r[0],a=r[4],o=r[8],s=r[1],c=r[5],l=r[9],u=r[2],d=r[6],f=r[10];switch(t){case`XYZ`:this._y=Math.asin(W(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-l,f),this._z=Math.atan2(-a,i)):(this._x=Math.atan2(d,c),this._z=0);break;case`YXZ`:this._x=Math.asin(-W(l,-1,1)),Math.abs(l)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(s,c)):(this._y=Math.atan2(-u,i),this._z=0);break;case`ZXY`:this._x=Math.asin(W(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(s,i));break;case`ZYX`:this._y=Math.asin(-W(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(s,i)):(this._x=0,this._z=Math.atan2(-a,c));break;case`YZX`:this._z=Math.asin(W(s,-1,1)),Math.abs(s)<.9999999?(this._x=Math.atan2(-l,c),this._y=Math.atan2(-u,i)):(this._x=0,this._y=Math.atan2(o,f));break;case`XZY`:this._z=Math.asin(-W(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,i)):(this._x=Math.atan2(-l,f),this._y=0);break;default:H(`Euler: .setFromRotationMatrix() encountered an unknown order: `+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Zc.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Zc,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Qc.setFromEuler(this),this.setFromQuaternion(Qc,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};$c.DEFAULT_ORDER=`XYZ`;var el=class{constructor(){this.mask=1}set(e){this.mask=1<<e>>>0}enable(e){this.mask|=1<<e}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e}disable(e){this.mask&=~(1<<e)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return!!(this.mask&1<<e)}},tl=0,nl=new q,rl=new wc,il=new J,al=new q,ol=new q,sl=new q,cl=new wc,ll=new q(1,0,0),ul=new q(0,1,0),dl=new q(0,0,1),fl={type:`added`},pl={type:`removed`},ml={type:`childadded`,child:null},hl={type:`childremoved`,child:null},gl=class e extends Qs{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:tl++}),this.uuid=rc(),this.name=``,this.type=`Object3D`,this.parent=null,this.children=[],this.up=e.DEFAULT_UP.clone();let t=new q,n=new $c,r=new wc,i=new q(1,1,1);function a(){r.setFromEuler(n,!1)}function o(){n.setFromQuaternion(r,void 0,!1)}n._onChange(a),r._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:r},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new J},normalMatrix:{value:new Dc}}),this.matrix=new J,this.matrixWorld=new J,this.matrixAutoUpdate=e.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=e.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new el,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return rl.setFromAxisAngle(e,t),this.quaternion.multiply(rl),this}rotateOnWorldAxis(e,t){return rl.setFromAxisAngle(e,t),this.quaternion.premultiply(rl),this}rotateX(e){return this.rotateOnAxis(ll,e)}rotateY(e){return this.rotateOnAxis(ul,e)}rotateZ(e){return this.rotateOnAxis(dl,e)}translateOnAxis(e,t){return nl.copy(e).applyQuaternion(this.quaternion),this.position.add(nl.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(ll,e)}translateY(e){return this.translateOnAxis(ul,e)}translateZ(e){return this.translateOnAxis(dl,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(il.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?al.copy(e):al.set(e,t,n);let r=this.parent;this.updateWorldMatrix(!0,!1),ol.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?il.lookAt(ol,al,this.up):il.lookAt(al,ol,this.up),this.quaternion.setFromRotationMatrix(il),r&&(il.extractRotation(r.matrixWorld),rl.setFromRotationMatrix(il),this.quaternion.premultiply(rl.invert()))}add(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return e===this?(U(`Object3D.add: object can't be added as a child of itself.`,e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(fl),ml.child=e,this.dispatchEvent(ml),ml.child=null):U(`Object3D.add: object not an instance of THREE.Object3D.`,e),this)}remove(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.remove(arguments[e]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(pl),hl.child=e,this.dispatchEvent(hl),hl.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),il.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),il.multiply(e.parent.matrixWorld)),e.applyMatrix4(il),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(fl),ml.child=e,this.dispatchEvent(ml),ml.child=null,this}getObjectById(e){return this.getObjectByProperty(`id`,e)}getObjectByName(e){return this.getObjectByProperty(`name`,e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,r=this.children.length;n<r;n++){let r=this.children[n].getObjectByProperty(e,t);if(r!==void 0)return r}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ol,e,sl),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ol,cl,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}intersectsFrustum(){}traverse(e){e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,r=e.z,i=this.matrix.elements;i[12]+=t-i[0]*t-i[4]*n-i[8]*r,i[13]+=n-i[1]*t-i[5]*n-i[9]*r,i[14]+=r-i[2]*t-i[6]*n-i[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let r=this.parent;if(e===!0&&r!==null&&r.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let e=this.children;for(let t=0,r=e.length;t<r;t++)e[t].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e==`string`,n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:`Object`,generator:`Object3D.toJSON`});let r={};r.uuid=this.uuid,r.type=this.type,r.name=this.name,r.castShadow=this.castShadow,r.receiveShadow=this.receiveShadow,r.visible=this.visible,r.frustumCulled=this.frustumCulled,r.renderOrder=this.renderOrder,r.static=this.static,r.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type=`InstancedMesh`,r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type=`BatchedMesh`,r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(e=>({...e,boundingBox:e.boundingBox?e.boundingBox.toJSON():void 0,boundingSphere:e.boundingSphere?e.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(e=>({...e})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function i(t,n){return t[n.uuid]===void 0&&(t[n.uuid]=n.toJSON(e)),n.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=i(e.geometries,this.geometry);let t=this.geometry.parameters;if(t!==void 0&&t.shapes!==void 0){let n=t.shapes;if(Array.isArray(n))for(let t=0,r=n.length;t<r;t++){let r=n[t];i(e.shapes,r)}else i(e.shapes,n)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(i(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0){if(Array.isArray(this.material)){let t=[];for(let n=0,r=this.material.length;n<r;n++)t.push(i(e.materials,this.material[n]));r.material=t}else r.material=i(e.materials,this.material)}if(this.children.length>0){r.children=[];for(let t=0;t<this.children.length;t++)r.children.push(this.children[t].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let t=0;t<this.animations.length;t++){let n=this.animations[t];r.animations.push(i(e.animations,n))}}if(t){let t=a(e.geometries),r=a(e.materials),i=a(e.textures),o=a(e.images),s=a(e.shapes),c=a(e.skeletons),l=a(e.animations),u=a(e.nodes);t.length>0&&(n.geometries=t),r.length>0&&(n.materials=r),i.length>0&&(n.textures=i),o.length>0&&(n.images=o),s.length>0&&(n.shapes=s),c.length>0&&(n.skeletons=c),l.length>0&&(n.animations=l),u.length>0&&(n.nodes=u)}return n.object=r,n;function a(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot===null?null:e.pivot.clone(),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let t=0;t<e.children.length;t++){let n=e.children[t];this.add(n.clone())}return this}dispose(){this.dispatchEvent({type:`dispose`})}};gl.DEFAULT_UP=new q(0,1,0),gl.DEFAULT_MATRIX_AUTO_UPDATE=!0,gl.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var _l=class extends gl{constructor(){super(),this.isGroup=!0,this.type=`Group`}},vl={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},yl={h:0,s:0,l:0},bl={h:0,s:0,l:0};function xl(e,t,n){return n<0&&(n+=1),n>1&&--n,n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*6*(2/3-n):e}var Y=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let t=e;t&&t.isColor?this.copy(t):typeof t==`number`?this.setHex(t):typeof t==`string`&&this.setStyle(t)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Rs){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Mc.colorSpaceToWorking(this,t),this}setRGB(e,t,n,r=Mc.workingColorSpace){return this.r=e,this.g=t,this.b=n,Mc.colorSpaceToWorking(this,r),this}setHSL(e,t,n,r=Mc.workingColorSpace){if(e=ic(e,1),t=W(t,0,1),n=W(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,i=2*n-r;this.r=xl(i,r,e+1/3),this.g=xl(i,r,e),this.b=xl(i,r,e-1/3)}return Mc.colorSpaceToWorking(this,r),this}setStyle(e,t=Rs){function n(t){t!==void 0&&parseFloat(t)<1&&H(`Color: Alpha component of `+e+` will be ignored.`)}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let i,a=r[1],o=r[2];switch(a){case`rgb`:case`rgba`:if(i=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(255,parseInt(i[1],10))/255,Math.min(255,parseInt(i[2],10))/255,Math.min(255,parseInt(i[3],10))/255,t);if(i=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(100,parseInt(i[1],10))/100,Math.min(100,parseInt(i[2],10))/100,Math.min(100,parseInt(i[3],10))/100,t);break;case`hsl`:case`hsla`:if(i=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setHSL(parseFloat(i[1])/360,parseFloat(i[2])/100,parseFloat(i[3])/100,t);break;default:H(`Color: Unknown color model `+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let n=r[1],i=n.length;if(i===3)return this.setRGB(parseInt(n.charAt(0),16)/15,parseInt(n.charAt(1),16)/15,parseInt(n.charAt(2),16)/15,t);if(i===6)return this.setHex(parseInt(n,16),t);H(`Color: Invalid hex color `+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Rs){let n=vl[e.toLowerCase()];return n===void 0?H(`Color: Unknown color `+e):this.setHex(n,t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Nc(e.r),this.g=Nc(e.g),this.b=Nc(e.b),this}copyLinearToSRGB(e){return this.r=Pc(e.r),this.g=Pc(e.g),this.b=Pc(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Rs){return Mc.workingToColorSpace(Sl.copy(this),e),Math.round(W(Sl.r*255,0,255))*65536+Math.round(W(Sl.g*255,0,255))*256+Math.round(W(Sl.b*255,0,255))}getHexString(e=Rs){return(`000000`+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Mc.workingColorSpace){Mc.workingToColorSpace(Sl.copy(this),t);let n=Sl.r,r=Sl.g,i=Sl.b,a=Math.max(n,r,i),o=Math.min(n,r,i),s,c,l=(o+a)/2;if(o===a)s=0,c=0;else{let e=a-o;switch(c=l<=.5?e/(a+o):e/(2-a-o),a){case n:s=(r-i)/e+(r<i?6:0);break;case r:s=(i-n)/e+2;break;case i:s=(n-r)/e+4}s/=6}return e.h=s,e.s=c,e.l=l,e}getRGB(e,t=Mc.workingColorSpace){return Mc.workingToColorSpace(Sl.copy(this),t),e.r=Sl.r,e.g=Sl.g,e.b=Sl.b,e}getStyle(e=Rs){Mc.workingToColorSpace(Sl.copy(this),e);let t=Sl.r,n=Sl.g,r=Sl.b;return e===`srgb`?`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(r*255)})`:`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`}offsetHSL(e,t,n){return this.getHSL(yl),this.setHSL(yl.h+e,yl.s+t,yl.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(yl),e.getHSL(bl);let n=sc(yl.h,bl.h,t),r=sc(yl.s,bl.s,t),i=sc(yl.l,bl.l,t);return this.setHSL(n,r,i),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,r=this.b,i=e.elements;return this.r=i[0]*t+i[3]*n+i[6]*r,this.g=i[1]*t+i[4]*n+i[7]*r,this.b=i[2]*t+i[5]*n+i[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},Sl=new Y;Y.NAMES=vl;var Cl=new q,wl=new q,Tl=new q,El=new q,Dl=new q,Ol=new q,kl=new q,Al=new q,jl=new q,Ml=new q,Nl=new Uc,Pl=new Uc,Fl=new Uc,Il=class e{constructor(e=new q,t=new q,n=new q){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,r){r.subVectors(n,t),Cl.subVectors(e,t),r.cross(Cl);let i=r.lengthSq();return i>0?r.multiplyScalar(1/Math.sqrt(i)):r.set(0,0,0)}static getBarycoord(e,t,n,r,i){Cl.subVectors(r,t),wl.subVectors(n,t),Tl.subVectors(e,t);let a=Cl.dot(Cl),o=Cl.dot(wl),s=Cl.dot(Tl),c=wl.dot(wl),l=wl.dot(Tl),u=a*c-o*o;if(u===0)return i.set(0,0,0),null;let d=1/u,f=(c*s-o*l)*d,p=(a*l-o*s)*d;return i.set(1-f-p,p,f)}static containsPoint(e,t,n,r){return this.getBarycoord(e,t,n,r,El)!==null&&El.x>=0&&El.y>=0&&El.x+El.y<=1}static getInterpolation(e,t,n,r,i,a,o,s){return this.getBarycoord(e,t,n,r,El)===null?(s.x=0,s.y=0,`z`in s&&(s.z=0),`w`in s&&(s.w=0),null):(s.setScalar(0),s.addScaledVector(i,El.x),s.addScaledVector(a,El.y),s.addScaledVector(o,El.z),s)}static getInterpolatedAttribute(e,t,n,r,i,a){return Nl.setScalar(0),Pl.setScalar(0),Fl.setScalar(0),Nl.fromBufferAttribute(e,t),Pl.fromBufferAttribute(e,n),Fl.fromBufferAttribute(e,r),a.setScalar(0),a.addScaledVector(Nl,i.x),a.addScaledVector(Pl,i.y),a.addScaledVector(Fl,i.z),a}static isFrontFacing(e,t,n,r){return Cl.subVectors(n,t),wl.subVectors(e,t),Cl.cross(wl).dot(r)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,r){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,n,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Cl.subVectors(this.c,this.b),wl.subVectors(this.a,this.b),Cl.cross(wl).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return e.getNormal(this.a,this.b,this.c,t)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,n){return e.getBarycoord(t,this.a,this.b,this.c,n)}getInterpolation(t,n,r,i,a){return e.getInterpolation(t,this.a,this.b,this.c,n,r,i,a)}containsPoint(t){return e.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return e.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,r=this.b,i=this.c,a,o;Dl.subVectors(r,n),Ol.subVectors(i,n),Al.subVectors(e,n);let s=Dl.dot(Al),c=Ol.dot(Al);if(s<=0&&c<=0)return t.copy(n);jl.subVectors(e,r);let l=Dl.dot(jl),u=Ol.dot(jl);if(l>=0&&u<=l)return t.copy(r);let d=s*u-l*c;if(d<=0&&s>=0&&l<=0)return a=s/(s-l),t.copy(n).addScaledVector(Dl,a);Ml.subVectors(e,i);let f=Dl.dot(Ml),p=Ol.dot(Ml);if(p>=0&&f<=p)return t.copy(i);let m=f*c-s*p;if(m<=0&&c>=0&&p<=0)return o=c/(c-p),t.copy(n).addScaledVector(Ol,o);let h=l*p-f*u;if(h<=0&&u-l>=0&&f-p>=0)return kl.subVectors(i,r),o=(u-l)/(u-l+(f-p)),t.copy(r).addScaledVector(kl,o);let g=1/(h+m+d);return a=m*g,o=d*g,t.copy(n).addScaledVector(Dl,a).addScaledVector(Ol,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Ll=class{constructor(e=new q(1/0,1/0,1/0),t=new q(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(zl.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(zl.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=zl.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute(`position`);if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let t=0,n=r.count;t<n;t++)e.isMesh===!0?e.getVertexPosition(t,zl):zl.fromBufferAttribute(r,t),zl.applyMatrix4(e.matrixWorld),this.expandByPoint(zl);else e.boundingBox===void 0?(n.boundingBox===null&&n.computeBoundingBox(),Bl.copy(n.boundingBox)):(e.boundingBox===null&&e.computeBoundingBox(),Bl.copy(e.boundingBox)),Bl.applyMatrix4(e.matrixWorld),this.union(Bl)}let r=e.children;for(let e=0,n=r.length;e<n;e++)this.expandByObject(r[e],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,zl),zl.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(ql),Jl.subVectors(this.max,ql),Vl.subVectors(e.a,ql),Hl.subVectors(e.b,ql),Ul.subVectors(e.c,ql),Wl.subVectors(Hl,Vl),Gl.subVectors(Ul,Hl),Kl.subVectors(Vl,Ul);let t=[0,-Wl.z,Wl.y,0,-Gl.z,Gl.y,0,-Kl.z,Kl.y,Wl.z,0,-Wl.x,Gl.z,0,-Gl.x,Kl.z,0,-Kl.x,-Wl.y,Wl.x,0,-Gl.y,Gl.x,0,-Kl.y,Kl.x,0];return!Zl(t,Vl,Hl,Ul,Jl)||(t=[1,0,0,0,1,0,0,0,1],!Zl(t,Vl,Hl,Ul,Jl))?!1:(Yl.crossVectors(Wl,Gl),t=[Yl.x,Yl.y,Yl.z],Zl(t,Vl,Hl,Ul,Jl))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,zl).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(zl).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()||(Rl[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Rl[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Rl[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Rl[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Rl[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Rl[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Rl[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Rl[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Rl)),this}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Rl=[new q,new q,new q,new q,new q,new q,new q,new q],zl=new q,Bl=new Ll,Vl=new q,Hl=new q,Ul=new q,Wl=new q,Gl=new q,Kl=new q,ql=new q,Jl=new q,Yl=new q,Xl=new q;function Zl(e,t,n,r,i){for(let a=0,o=e.length-3;a<=o;a+=3){Xl.fromArray(e,a);let o=i.x*Math.abs(Xl.x)+i.y*Math.abs(Xl.y)+i.z*Math.abs(Xl.z),s=t.dot(Xl),c=n.dot(Xl),l=r.dot(Xl);if(Math.max(-Math.max(s,c,l),Math.min(s,c,l))>o)return!1}return!0}var Ql=$l();function $l(){let e=new ArrayBuffer(4),t=new Float32Array(e),n=new Uint32Array(e),r=new Uint32Array(512),i=new Uint32Array(512);for(let e=0;e<256;++e){let t=e-127;t<-27?(r[e]=0,r[e|256]=32768,i[e]=24,i[e|256]=24):t<-14?(r[e]=1024>>-t-14,r[e|256]=1024>>-t-14|32768,i[e]=-t-1,i[e|256]=-t-1):t<=15?(r[e]=t+15<<10,r[e|256]=t+15<<10|32768,i[e]=13,i[e|256]=13):t<128?(r[e]=31744,r[e|256]=64512,i[e]=24,i[e|256]=24):(r[e]=31744,r[e|256]=64512,i[e]=13,i[e|256]=13)}let a=new Uint32Array(2048),o=new Uint32Array(64),s=new Uint32Array(64);for(let e=1;e<1024;++e){let t=e<<13,n=0;for(;!(t&8388608);)t<<=1,n-=8388608;t&=-8388609,n+=947912704,a[e]=t|n}for(let e=1024;e<2048;++e)a[e]=939524096+(e-1024<<13);for(let e=1;e<31;++e)o[e]=e<<23;o[31]=1199570944,o[32]=2147483648;for(let e=33;e<63;++e)o[e]=2147483648+(e-32<<23);o[63]=3347054592;for(let e=1;e<64;++e)e!==32&&(s[e]=1024);return{floatView:t,uint32View:n,baseTable:r,shiftTable:i,mantissaTable:a,exponentTable:o,offsetTable:s}}function eu(e){Math.abs(e)>65504&&H(`DataUtils.toHalfFloat(): Value out of range.`),e=W(e,-65504,65504),Ql.floatView[0]=e;let t=Ql.uint32View[0],n=t>>23&511;return Ql.baseTable[n]+((t&8388607)>>Ql.shiftTable[n])}function tu(e){let t=e>>10;return Ql.uint32View[0]=Ql.mantissaTable[Ql.offsetTable[t]+(e&1023)]+Ql.exponentTable[t],Ql.floatView[0]}var nu=class{static toHalfFloat(e){return eu(e)}static fromHalfFloat(e){return tu(e)}},X=new q,ru=new K,iu=0,au=class extends Qs{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw TypeError(`THREE.BufferAttribute: array should be a Typed Array.`);this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:iu++}),this.name=``,this.array=e,this.itemSize=t,this.count=e===void 0?0:e.length/t,this.normalized=n,this.usage=Us,this.updateRanges=[],this.gpuType=Ts,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let r=0,i=this.itemSize;r<i;r++)this.array[e+r]=t.array[n+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)ru.fromBufferAttribute(this,t),ru.applyMatrix3(e),this.setXY(t,ru.x,ru.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)X.fromBufferAttribute(this,t),X.applyMatrix3(e),this.setXYZ(t,X.x,X.y,X.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)X.fromBufferAttribute(this,t),X.applyMatrix4(e),this.setXYZ(t,X.x,X.y,X.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)X.fromBufferAttribute(this,t),X.applyNormalMatrix(e),this.setXYZ(t,X.x,X.y,X.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)X.fromBufferAttribute(this,t),X.transformDirection(e),this.setXYZ(t,X.x,X.y,X.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Sc(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=G(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Sc(t,this.array)),t}setX(e,t){return this.normalized&&(t=G(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Sc(t,this.array)),t}setY(e,t){return this.normalized&&(t=G(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Sc(t,this.array)),t}setZ(e,t){return this.normalized&&(t=G(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Sc(t,this.array)),t}setW(e,t){return this.normalized&&(t=G(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=G(t,this.array),n=G(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,r){return e*=this.itemSize,this.normalized&&(t=G(t,this.array),n=G(n,this.array),r=G(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this}setXYZW(e,t,n,r,i){return e*=this.itemSize,this.normalized&&(t=G(t,this.array),n=G(n,this.array),r=G(r,this.array),i=G(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this.array[e+3]=i,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return e.name=this.name,e.usage=this.usage,e.gpuType=this.gpuType,e}dispose(){this.dispatchEvent({type:`dispose`})}},ou=class extends au{constructor(e,t,n){super(new Uint16Array(e),t,n)}},su=class extends au{constructor(e,t,n){super(new Uint32Array(e),t,n)}},cu=class extends au{constructor(e,t,n){super(new Float32Array(e),t,n)}},lu=new Ll,uu=new q,du=new q,fu=class{constructor(e=new q,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t===void 0?lu.setFromPoints(e).getCenter(n):n.copy(t);let r=0;for(let t=0,i=e.length;t<i;t++)r=Math.max(r,n.distanceToSquared(e[t]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius*=e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;uu.subVectors(e,this.center);let t=uu.lengthSq();if(t>this.radius*this.radius){let e=Math.sqrt(t),n=(e-this.radius)*.5;this.center.addScaledVector(uu,n/e),this.radius+=n}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(du.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(uu.copy(e.center).add(du)),this.expandByPoint(uu.copy(e.center).sub(du))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},pu=0,mu=new J,hu=new gl,gu=new q,_u=new Ll,vu=new Ll,yu=new q,bu=class e extends Qs{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:pu++}),this.uuid=rc(),this.name=``,this.type=`BufferGeometry`,this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return this.index=Array.isArray(e)?new(Gs(e)?su:ou)(e,1):e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let t=new Dc().getNormalMatrix(e);n.applyNormalMatrix(t),n.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return mu.makeRotationFromQuaternion(e),this.applyMatrix4(mu),this}rotateX(e){return mu.makeRotationX(e),this.applyMatrix4(mu),this}rotateY(e){return mu.makeRotationY(e),this.applyMatrix4(mu),this}rotateZ(e){return mu.makeRotationZ(e),this.applyMatrix4(mu),this}translate(e,t,n){return mu.makeTranslation(e,t,n),this.applyMatrix4(mu),this}scale(e,t,n){return mu.makeScale(e,t,n),this.applyMatrix4(mu),this}lookAt(e){return hu.lookAt(e),hu.updateMatrix(),this.applyMatrix4(hu.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(gu).negate(),this.translate(gu.x,gu.y,gu.z),this}setFromPoints(e){let t=this.getAttribute(`position`);if(t===void 0){let t=[];for(let n=0,r=e.length;n<r;n++){let r=e[n];t.push(r.x,r.y,r.z||0)}this.setAttribute(`position`,new cu(t,3))}else{let n=Math.min(e.length,t.count);for(let r=0;r<n;r++){let n=e[r];t.setXYZ(r,n.x,n.y,n.z||0)}e.length>t.count&&H(`BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.`),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ll);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute)U(`BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.`,this),this.boundingBox.set(new q(-1/0,-1/0,-1/0),new q(1/0,1/0,1/0));else{if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];_u.setFromBufferAttribute(n),this.morphTargetsRelative?(yu.addVectors(this.boundingBox.min,_u.min),this.boundingBox.expandByPoint(yu),yu.addVectors(this.boundingBox.max,_u.max),this.boundingBox.expandByPoint(yu)):(this.boundingBox.expandByPoint(_u.min),this.boundingBox.expandByPoint(_u.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&U(`BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.`,this)}}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new fu);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute)U(`BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.`,this),this.boundingSphere.set(new q,1/0);else if(e){let n=this.boundingSphere.center;if(_u.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];vu.setFromBufferAttribute(n),this.morphTargetsRelative?(yu.addVectors(_u.min,vu.min),_u.expandByPoint(yu),yu.addVectors(_u.max,vu.max),_u.expandByPoint(yu)):(_u.expandByPoint(vu.min),_u.expandByPoint(vu.max))}_u.getCenter(n);let r=0;for(let t=0,i=e.count;t<i;t++)yu.fromBufferAttribute(e,t),r=Math.max(r,n.distanceToSquared(yu));if(t)for(let i=0,a=t.length;i<a;i++){let a=t[i],o=this.morphTargetsRelative;for(let t=0,i=a.count;t<i;t++)yu.fromBufferAttribute(a,t),o&&(gu.fromBufferAttribute(e,t),yu.add(gu)),r=Math.max(r,n.distanceToSquared(yu))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&U(`BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.`,this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){U(`BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)`);return}let n=t.position,r=t.normal,i=t.uv,a=this.getAttribute(`tangent`);(a===void 0||a.count!==n.count)&&(a=new au(new Float32Array(4*n.count),4),this.setAttribute(`tangent`,a));let o=[],s=[];for(let e=0;e<n.count;e++)o[e]=new q,s[e]=new q;let c=new q,l=new q,u=new q,d=new K,f=new K,p=new K,m=new q,h=new q;function g(e,t,r){c.fromBufferAttribute(n,e),l.fromBufferAttribute(n,t),u.fromBufferAttribute(n,r),d.fromBufferAttribute(i,e),f.fromBufferAttribute(i,t),p.fromBufferAttribute(i,r),l.sub(c),u.sub(c),f.sub(d),p.sub(d);let a=1/(f.x*p.y-p.x*f.y);isFinite(a)&&(m.copy(l).multiplyScalar(p.y).addScaledVector(u,-f.y).multiplyScalar(a),h.copy(u).multiplyScalar(f.x).addScaledVector(l,-p.x).multiplyScalar(a),o[e].add(m),o[t].add(m),o[r].add(m),s[e].add(h),s[t].add(h),s[r].add(h))}let _=this.groups;_.length===0&&(_=[{start:0,count:e.count}]);for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)g(e.getX(t+0),e.getX(t+1),e.getX(t+2))}let v=new q,y=new q,b=new q,x=new q;function S(e){b.fromBufferAttribute(r,e),x.copy(b);let t=o[e];v.copy(t),v.sub(b.multiplyScalar(b.dot(t))).normalize(),y.crossVectors(x,t);let n=y.dot(s[e])<0?-1:1;a.setXYZW(e,v.x,v.y,v.z,n)}for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)S(e.getX(t+0)),S(e.getX(t+1)),S(e.getX(t+2))}this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute(`position`);if(t!==void 0){let n=this.getAttribute(`normal`);if(n===void 0||n.count!==t.count)n=new au(new Float32Array(t.count*3),3),this.setAttribute(`normal`,n);else for(let e=0,t=n.count;e<t;e++)n.setXYZ(e,0,0,0);let r=new q,i=new q,a=new q,o=new q,s=new q,c=new q,l=new q,u=new q;if(e)for(let d=0,f=e.count;d<f;d+=3){let f=e.getX(d+0),p=e.getX(d+1),m=e.getX(d+2);r.fromBufferAttribute(t,f),i.fromBufferAttribute(t,p),a.fromBufferAttribute(t,m),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),o.fromBufferAttribute(n,f),s.fromBufferAttribute(n,p),c.fromBufferAttribute(n,m),o.add(l),s.add(l),c.add(l),n.setXYZ(f,o.x,o.y,o.z),n.setXYZ(p,s.x,s.y,s.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let e=0,o=t.count;e<o;e+=3)r.fromBufferAttribute(t,e+0),i.fromBufferAttribute(t,e+1),a.fromBufferAttribute(t,e+2),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),n.setXYZ(e+0,l.x,l.y,l.z),n.setXYZ(e+1,l.x,l.y,l.z),n.setXYZ(e+2,l.x,l.y,l.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)yu.fromBufferAttribute(e,t),yu.normalize(),e.setXYZ(t,yu.x,yu.y,yu.z)}toNonIndexed(){function t(e,t){let n=e.array,r=e.itemSize,i=e.normalized,a=new n.constructor(t.length*r),o=0,s=0;for(let i=0,c=t.length;i<c;i++){o=e.isInterleavedBufferAttribute?t[i]*e.data.stride+e.offset:t[i]*r;for(let e=0;e<r;e++)a[s++]=n[o++]}return new au(a,r,i)}if(this.index===null)return H(`BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.`),this;let n=new e,r=this.index.array,i=this.attributes;for(let e in i){let a=i[e],o=t(a,r);n.setAttribute(e,o)}let a=this.morphAttributes;for(let e in a){let i=[],o=a[e];for(let e=0,n=o.length;e<n;e++){let n=o[e],a=t(n,r);i.push(a)}n.morphAttributes[e]=i}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let e=0,t=o.length;e<t;e++){let t=o[e];n.addGroup(t.start,t.count,t.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:`BufferGeometry`,generator:`BufferGeometry.toJSON`}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?`BufferGeometry`:this.type,e.name=this.name,Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let t=this.parameters;for(let n in t)t[n]!==void 0&&(e[n]=t[n]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let t in n){let r=n[t];e.data.attributes[t]=r.toJSON(e.data)}let r={},i=!1;for(let t in this.morphAttributes){let n=this.morphAttributes[t],a=[];for(let t=0,r=n.length;t<r;t++){let r=n[t];a.push(r.toJSON(e.data))}a.length>0&&(r[t]=a,i=!0)}i&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let r=e.attributes;for(let e in r){let n=r[e];this.setAttribute(e,n.clone(t))}let i=e.morphAttributes;for(let e in i){let n=[],r=i[e];for(let e=0,i=r.length;e<i;e++)n.push(r[e].clone(t));this.morphAttributes[e]=n}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let e=0,t=a.length;e<t;e++){let t=a[e];this.addGroup(t.start,t.count,t.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let s=e.boundingSphere;return s!==null&&(this.boundingSphere=s.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:`dispose`})}},xu=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e===void 0?0:e.length/t,this.usage=Us,this.updateRanges=[],this.version=0,this.uuid=rc()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let r=0,i=this.stride;r<i;r++)this.array[e+r]=t.array[n+r];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=rc()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=rc()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer)));let t={uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride};return t.usage=this.usage,t}},Su=new q,Cu=class e{constructor(e,t,n,r=!1){this.isInterleavedBufferAttribute=!0,this.name=``,this.data=e,this.itemSize=t,this.offset=n,this.normalized=r}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Su.fromBufferAttribute(this,t),Su.applyMatrix4(e),this.setXYZ(t,Su.x,Su.y,Su.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Su.fromBufferAttribute(this,t),Su.applyNormalMatrix(e),this.setXYZ(t,Su.x,Su.y,Su.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Su.fromBufferAttribute(this,t),Su.transformDirection(e),this.setXYZ(t,Su.x,Su.y,Su.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=Sc(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=G(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=G(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=G(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=G(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=G(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=Sc(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=Sc(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=Sc(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=Sc(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=G(t,this.array),n=G(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=G(t,this.array),n=G(n,this.array),r=G(r,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=r,this}setXYZW(e,t,n,r,i){return e=e*this.data.stride+this.offset,this.normalized&&(t=G(t,this.array),n=G(n,this.array),r=G(r,this.array),i=G(i,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=r,this.data.array[e+3]=i,this}clone(t){if(t===void 0){Ys(`InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.`);let e=[];for(let t=0;t<this.count;t++){let n=t*this.data.stride+this.offset;for(let t=0;t<this.itemSize;t++)e.push(this.data.array[n+t])}return new au(new this.array.constructor(e),this.itemSize,this.normalized)}return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new e(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){Ys(`InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.`);let e=[];for(let t=0;t<this.count;t++){let n=t*this.data.stride+this.offset;for(let t=0;t<this.itemSize;t++)e.push(this.data.array[n+t])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}},wu=new q,Tu=new q,Eu=new Dc,Du=class{constructor(e=new q(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=wu.subVectors(n,t).cross(Tu.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let r=e.delta(wu),i=this.normal.dot(r);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/i;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||Eu.getNormalMatrix(e),r=this.coplanarPoint(wu).applyMatrix4(e),i=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(i),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},Ou=0,ku=class extends Qs{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Ou++}),this.uuid=rc(),this.name=``,this.type=`Material`,this.blending=1,this.side=0,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=204,this.blendDst=205,this.blendEquation=100,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Y(0,0,0),this.blendAlpha=0,this.depthFunc=3,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=519,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Hs,this.stencilZFail=Hs,this.stencilZPass=Hs,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){H(`Material: parameter '${t}' has value of undefined.`);continue}let r=this[t];r===void 0?H(`Material: '${t}' is not a property of THREE.${this.type}.`):r&&r.isColor?r.set(n):r&&r.isVector2&&n&&n.isVector2||r&&r.isEuler&&n&&n.isEuler||r&&r.isVector3&&n&&n.isVector3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:`Material`,generator:`Material.toJSON`}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(e=>e.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function r(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}if(t){let t=r(e.textures),i=r(e.images);t.length>0&&(n.textures=t),i.length>0&&(n.images=i)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new Y().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.retroreflectivity!==void 0&&(this.retroreflectivity=e.retroreflectivity),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=e.iridescenceThicknessRange),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.clippingPlanes!==void 0&&(this.clippingPlanes=e.clippingPlanes.map(e=>new Du().fromJSON(e))),e.clipIntersection!==void 0&&(this.clipIntersection=e.clipIntersection),e.clipShadows!==void 0&&(this.clipShadows=e.clipShadows),e.depthPacking!==void 0&&(this.depthPacking=e.depthPacking),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.linecap!==void 0&&(this.linecap=e.linecap),e.linejoin!==void 0&&(this.linejoin=e.linejoin),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(this.vertexColors=typeof e.vertexColors==`number`?e.vertexColors>0:e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let t=e.normalScale;Array.isArray(t)===!1&&(t=[t,t]),this.normalScale=new K().fromArray(t)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new K().fromArray(e.clearcoatNormalScale)),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let e=t.length;n=Array(e);for(let r=0;r!==e;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:`dispose`})}set needsUpdate(e){e===!0&&this.version++}},Au=new q,ju=new q,Mu=new q,Nu=new q,Pu=class{constructor(e=new q,t=new q(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Au)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=Au.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Au.copy(this.origin).addScaledVector(this.direction,t),Au.distanceToSquared(e))}distanceSqToSegment(e,t,n,r){ju.copy(e).add(t).multiplyScalar(.5),Mu.copy(t).sub(e).normalize(),Nu.copy(this.origin).sub(ju);let i=e.distanceTo(t)*.5,a=-this.direction.dot(Mu),o=Nu.dot(this.direction),s=-Nu.dot(Mu),c=Nu.lengthSq(),l=Math.abs(1-a*a),u,d,f,p;if(l>0){if(u=a*s-o,d=a*o-s,p=i*l,u>=0){if(d>=-p){if(d<=p){let e=1/l;u*=e,d*=e,f=u*(u+a*d+2*o)+d*(a*u+d+2*s)+c}else d=i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c}else d=-i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c}else d<=-p?(u=Math.max(0,-(-a*i+o)),d=u>0?-i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c):d<=p?(u=0,d=Math.min(Math.max(-i,-s),i),f=d*(d+2*s)+c):(u=Math.max(0,-(a*i+o)),d=u>0?i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c)}else d=a>0?-i:i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),r&&r.copy(ju).addScaledVector(Mu,d),f}intersectSphere(e,t){if(e.radius<0)return null;Au.subVectors(e.center,this.origin);let n=Au.dot(this.direction),r=Au.dot(Au)-n*n,i=e.radius*e.radius;if(r>i)return null;let a=Math.sqrt(i-r),o=n-a,s=n+a;return s<0?null:o<0?this.at(s,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,r,i,a,o,s,c=1/this.direction.x,l=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,r=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,r=(e.min.x-d.x)*c),l>=0?(i=(e.min.y-d.y)*l,a=(e.max.y-d.y)*l):(i=(e.max.y-d.y)*l,a=(e.min.y-d.y)*l),n>a||i>r||((i>n||isNaN(n))&&(n=i),(a<r||isNaN(r))&&(r=a),u>=0?(o=(e.min.z-d.z)*u,s=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,s=(e.min.z-d.z)*u),n>s||o>r)||((o>n||n!==n)&&(n=o),(s<r||r!==r)&&(r=s),r<0)?null:this.at(n>=0?n:r,t)}intersectsBox(e){return this.intersectBox(e,Au)!==null}intersectTriangle(e,t,n,r,i){let a=this.origin,o=this.direction,s=o.x,c=o.y,l=o.z,u=e.x-a.x,d=e.y-a.y,f=e.z-a.z,p=t.x-a.x,m=t.y-a.y,h=t.z-a.z,g=n.x-a.x,_=n.y-a.y,v=n.z-a.z,y=Math.abs(s),b=Math.abs(c),x=Math.abs(l),S,C,w,T,E,D,O,k,A,j,M,ee;if(y>=b&&y>=x?(w=s,D=u,A=p,ee=g,s>=0?(S=c,C=l,T=d,E=f,O=m,k=h,j=_,M=v):(S=l,C=c,T=f,E=d,O=h,k=m,j=v,M=_)):b>=x?(w=c,D=d,A=m,ee=_,c>=0?(S=l,C=s,T=f,E=u,O=h,k=p,j=v,M=g):(S=s,C=l,T=u,E=f,O=p,k=h,j=g,M=v)):(w=l,D=f,A=h,ee=v,l>=0?(S=s,C=c,T=u,E=d,O=p,k=m,j=g,M=_):(S=c,C=s,T=d,E=u,O=m,k=p,j=_,M=g)),w===0)return null;let te=S/w,ne=C/w,re=1/w,ie=T-te*D,ae=E-ne*D,oe=O-te*A,se=k-ne*A,ce=j-te*ee,le=M-ne*ee,ue=ce*se-le*oe,de=ie*le-ae*ce,fe=oe*ae-se*ie;if(r){if(ue<0||de<0||fe<0)return null}else if((ue<0||de<0||fe<0)&&(ue>0||de>0||fe>0))return null;let pe=ue+de+fe;if(pe===0)return null;let me=re*(ue*D+de*A+fe*ee);return(pe>0?me<0:me>0)?null:this.at(me/pe,i)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},Fu=class extends ku{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type=`MeshBasicMaterial`,this.color=new Y(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new $c,this.combine=0,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Iu=new J,Lu=new Pu,Ru=new fu,zu=new q,Bu=new q,Vu=new q,Hu=new q,Uu=new q,Wu=new q,Gu=new q,Ku=new q,qu=class extends gl{constructor(e=new bu,t=new Fu){super(),this.isMesh=!0,this.type=`Mesh`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}getVertexPosition(e,t){let n=this.geometry,r=n.attributes.position,i=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(r,e);let o=this.morphTargetInfluences;if(i&&o){Wu.set(0,0,0);for(let n=0,r=i.length;n<r;n++){let r=o[n],s=i[n];r!==0&&(Uu.fromBufferAttribute(s,e),a?Wu.addScaledVector(Uu,r):Wu.addScaledVector(Uu.sub(t),r))}t.add(Wu)}return t}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.material,i=this.matrixWorld;r!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Ru.copy(n.boundingSphere),Ru.applyMatrix4(i),Lu.copy(e.ray).recast(e.near),!(Ru.containsPoint(Lu.origin)===!1&&(Lu.intersectSphere(Ru,zu)===null||Lu.origin.distanceToSquared(zu)>(e.far-e.near)**2))&&(Iu.copy(i).invert(),Lu.copy(e.ray).applyMatrix4(Iu),(n.boundingBox===null||Lu.intersectsBox(n.boundingBox)!==!1)&&this._computeIntersections(e,t,Lu)))}_computeIntersections(e,t,n){let r,i=this.geometry,a=this.material,o=i.index,s=i.attributes.position,c=i.attributes.uv,l=i.attributes.uv1,u=i.attributes.normal,d=i.groups,f=i.drawRange;if(o!==null){if(Array.isArray(a))for(let i=0,s=d.length;i<s;i++){let s=d[i],p=a[s.materialIndex],m=Math.max(s.start,f.start),h=Math.min(o.count,Math.min(s.start+s.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=o.getX(i),d=o.getX(i+1),f=o.getX(i+2);r=Yu(this,p,e,n,c,l,u,a,d,f),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=s.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),s=Math.min(o.count,f.start+f.count);for(let d=i,f=s;d<f;d+=3){let i=o.getX(d),s=o.getX(d+1),f=o.getX(d+2);r=Yu(this,a,e,n,c,l,u,i,s,f),r&&(r.faceIndex=Math.floor(d/3),t.push(r))}}}else if(s!==void 0){if(Array.isArray(a))for(let i=0,o=d.length;i<o;i++){let o=d[i],p=a[o.materialIndex],m=Math.max(o.start,f.start),h=Math.min(s.count,Math.min(o.start+o.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=i,s=i+1,d=i+2;r=Yu(this,p,e,n,c,l,u,a,s,d),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=o.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),o=Math.min(s.count,f.start+f.count);for(let s=i,d=o;s<d;s+=3){let i=s,o=s+1,d=s+2;r=Yu(this,a,e,n,c,l,u,i,o,d),r&&(r.faceIndex=Math.floor(s/3),t.push(r))}}}}};function Ju(e,t,n,r,i,a,o,s){let c;if(c=t.side===1?r.intersectTriangle(o,a,i,!0,s):r.intersectTriangle(i,a,o,t.side===0,s),c===null)return null;Ku.copy(s),Ku.applyMatrix4(e.matrixWorld);let l=n.ray.origin.distanceTo(Ku);return l<n.near||l>n.far?null:{distance:l,point:Ku.clone(),object:e}}function Yu(e,t,n,r,i,a,o,s,c,l){e.getVertexPosition(s,Bu),e.getVertexPosition(c,Vu),e.getVertexPosition(l,Hu);let u=Ju(e,t,n,r,Bu,Vu,Hu,Gu);if(u){let e=new q;Il.getBarycoord(Gu,Bu,Vu,Hu,e),i&&(u.uv=Il.getInterpolatedAttribute(i,s,c,l,e,new K)),a&&(u.uv1=Il.getInterpolatedAttribute(a,s,c,l,e,new K)),o&&(u.normal=Il.getInterpolatedAttribute(o,s,c,l,e,new q),u.normal.dot(r.direction)>0&&u.normal.multiplyScalar(-1));let t={a:s,b:c,c:l,normal:new q,materialIndex:0};Il.getNormal(Bu,Vu,Hu,t.normal),u.face=t,u.barycoord=e}return u}var Xu=new Uc,Zu=new Uc,Qu=new Uc,$u=new Uc,ed=new J,td=new q,nd=new fu,rd=new J,id=new Pu,ad=class extends qu{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type=`SkinnedMesh`,this.bindMode=ms,this.bindMatrix=new J,this.bindMatrixInverse=new J,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){let e=this.geometry;this.boundingBox===null&&(this.boundingBox=new Ll),this.boundingBox.makeEmpty();let t=e.getAttribute(`position`);for(let e=0;e<t.count;e++)this.getVertexPosition(e,td),this.boundingBox.expandByPoint(td)}computeBoundingSphere(){let e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new fu),this.boundingSphere.makeEmpty();let t=e.getAttribute(`position`);for(let e=0;e<t.count;e++)this.getVertexPosition(e,td),this.boundingSphere.expandByPoint(td)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){let n=this.material,r=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),nd.copy(this.boundingSphere),nd.applyMatrix4(r),e.ray.intersectsSphere(nd)!==!1&&(rd.copy(r).invert(),id.copy(e.ray).applyMatrix4(rd),(this.boundingBox===null||id.intersectsBox(this.boundingBox)!==!1)&&this._computeIntersections(e,t,id)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){let e=new Uc,t=this.geometry.attributes.skinWeight;for(let n=0,r=t.count;n<r;n++){e.fromBufferAttribute(t,n);let r=1/e.manhattanLength();r===1/0?e.set(1,0,0,0):e.multiplyScalar(r),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===`attached`?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===`detached`?this.bindMatrixInverse.copy(this.bindMatrix).invert():H(`SkinnedMesh: Unrecognized bindMode: `+this.bindMode)}applyBoneTransform(e,t){let n=this.skeleton,r=this.geometry;Zu.fromBufferAttribute(r.attributes.skinIndex,e),Qu.fromBufferAttribute(r.attributes.skinWeight,e),t.isVector4?(Xu.copy(t),t.set(0,0,0,0)):(Xu.set(...t,1),t.set(0,0,0)),Xu.applyMatrix4(this.bindMatrix);for(let e=0;e<4;e++){let r=Qu.getComponent(e);if(r!==0){let i=Zu.getComponent(e);ed.multiplyMatrices(n.bones[i].matrixWorld,n.boneInverses[i]),t.addScaledVector($u.copy(Xu).applyMatrix4(ed),r)}}return t.isVector4&&(t.w=Xu.w),t.applyMatrix4(this.bindMatrixInverse)}},od=class extends gl{constructor(){super(),this.isBone=!0,this.type=`Bone`}},sd=class extends Hc{constructor(e=null,t=1,n=1,r,i,a,o,s,c=vs,l=vs,u,d){super(null,a,o,s,c,l,r,i,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},cd=new J,ld=new J,ud=class e{constructor(e=[],t=[]){this.uuid=rc(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){let e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){H(`Skeleton: Number of inverse bone matrices does not match amount of bones.`),this.boneInverses=[];for(let e=0,t=this.bones.length;e<t;e++)this.boneInverses.push(new J)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){let t=new J;this.bones[e]&&t.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(t)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){let t=this.bones[e];t&&t.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){let t=this.bones[e];t&&(t.parent&&t.parent.isBone?(t.matrix.copy(t.parent.matrixWorld).invert(),t.matrix.multiply(t.matrixWorld)):t.matrix.copy(t.matrixWorld),t.matrix.decompose(t.position,t.quaternion,t.scale))}}update(){let e=this.bones,t=this.boneInverses,n=this.boneMatrices,r=this.boneTexture;for(let r=0,i=e.length;r<i;r++){let i=e[r]?e[r].matrixWorld:ld;cd.multiplyMatrices(i,t[r]),cd.toArray(n,r*16)}r!==null&&(r.needsUpdate=!0)}clone(){return new e(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);let t=new Float32Array(e*e*4);t.set(this.boneMatrices);let n=new sd(t,e,e,Ds,Ts);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){let n=this.bones[t];if(n.name===e)return n}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,r=e.bones.length;n<r;n++){let r=e.bones[n],i=t[r];i===void 0&&(H(`Skeleton: No bone found with UUID:`,r),i=new od),this.bones.push(i),this.boneInverses.push(new J().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){let e={metadata:{version:4.7,type:`Skeleton`,generator:`Skeleton.toJSON`},bones:[],boneInverses:[]};e.uuid=this.uuid;let t=this.bones,n=this.boneInverses;for(let r=0,i=t.length;r<i;r++){let i=t[r];e.bones.push(i.uuid);let a=n[r];e.boneInverses.push(a.toArray())}return e}},dd=class extends au{constructor(e,t,n,r=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},fd=new J,pd=new J,md=[],hd=new Ll,gd=new J,_d=new qu,vd=new fu,yd=class extends qu{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new dd(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let e=0;e<n;e++)this.setMatrixAt(e,gd)}computeBoundingBox(){let e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new Ll),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,fd),hd.copy(e.boundingBox).applyMatrix4(fd),this.boundingBox.union(hd)}computeBoundingSphere(){let e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new fu),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,fd),vd.copy(e.boundingSphere).applyMatrix4(fd),this.boundingSphere.union(vd)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){return this.instanceColor===null?t.setRGB(1,1,1):t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){return t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){let n=t.morphTargetInfluences,r=this.morphTexture.source.data.data,i=e*(n.length+1)+1;for(let e=0;e<n.length;e++)n[e]=r[i+e]}raycast(e,t){let n=this.matrixWorld,r=this.count;if(_d.geometry=this.geometry,_d.material=this.material,_d.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),vd.copy(this.boundingSphere),vd.applyMatrix4(n),e.ray.intersectsSphere(vd)!==!1))for(let i=0;i<r;i++){this.getMatrixAt(i,fd),pd.multiplyMatrices(n,fd),_d.matrixWorld=pd,_d.raycast(e,md);for(let e=0,n=md.length;e<n;e++){let n=md[e];n.instanceId=i,n.object=this,t.push(n)}md.length=0}}setColorAt(e,t){return this.instanceColor===null&&(this.instanceColor=new dd(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3),this}setMatrixAt(e,t){return t.toArray(this.instanceMatrix.array,e*16),this}setMorphAt(e,t){let n=t.morphTargetInfluences,r=n.length+1;this.morphTexture===null&&(this.morphTexture=new sd(new Float32Array(r*this.count),r,this.count,Os,Ts));let i=this.morphTexture.source.data.data,a=0;for(let e=0;e<n.length;e++)a+=n[e];let o=this.geometry.morphTargetsRelative?1:1-a,s=r*e;return i[s]=o,i.set(n,s+1),this}updateMorphTargets(){}dispose(){super.dispose(),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}},bd=new fu,xd=new K(.5,.5),Sd=new q,Cd=class{constructor(e=new Du,t=new Du,n=new Du,r=new Du,i=new Du,a=new Du){this.planes=[e,t,n,r,i,a]}set(e,t,n,r,i,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(r),o[4].copy(i),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Ws,n=!1){let r=this.planes,i=e.elements,a=i[0],o=i[1],s=i[2],c=i[3],l=i[4],u=i[5],d=i[6],f=i[7],p=i[8],m=i[9],h=i[10],g=i[11],_=i[12],v=i[13],y=i[14],b=i[15];if(r[0].setComponents(c-a,f-l,g-p,b-_).normalize(),r[1].setComponents(c+a,f+l,g+p,b+_).normalize(),r[2].setComponents(c+o,f+u,g+m,b+v).normalize(),r[3].setComponents(c-o,f-u,g-m,b-v).normalize(),n)r[4].setComponents(s,d,h,y).normalize(),r[5].setComponents(c-s,f-d,g-h,b-y).normalize();else if(r[4].setComponents(c-s,f-d,g-h,b-y).normalize(),t===2e3)r[5].setComponents(c+s,f+d,g+h,b+y).normalize();else if(t===2001)r[5].setComponents(s,d,h,y).normalize();else throw Error(`THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: `+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),bd.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),bd.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(bd)}intersectsSprite(e){return bd.center.set(0,0,0),bd.radius=.7071067811865476+xd.distanceTo(e.center),bd.applyMatrix4(e.matrixWorld),this.intersectsSphere(bd)}intersectsSphere(e){let t=this.planes,n=e.center,r=-e.radius;for(let e=0;e<6;e++)if(t[e].distanceToPoint(n)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let r=t[n];if(Sd.x=r.normal.x>0?e.max.x:e.min.x,Sd.y=r.normal.y>0?e.max.y:e.min.y,Sd.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(Sd)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},wd=class extends ku{constructor(e){super(),this.isLineBasicMaterial=!0,this.type=`LineBasicMaterial`,this.color=new Y(16777215),this.map=null,this.linewidth=1,this.linecap=`round`,this.linejoin=`round`,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},Td=new q,Ed=new q,Dd=new J,Od=new Pu,kd=new fu,Ad=new q,jd=new q,Md=class extends gl{constructor(e=new bu,t=new wd){super(),this.isLine=!0,this.type=`Line`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let e=1,r=t.count;e<r;e++)Td.fromBufferAttribute(t,e-1),Ed.fromBufferAttribute(t,e),n[e]=n[e-1],n[e]+=Td.distanceTo(Ed);e.setAttribute(`lineDistance`,new cu(n,1))}else H(`Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.`);return this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.matrixWorld,i=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),kd.copy(n.boundingSphere),kd.applyMatrix4(r),kd.radius+=i,e.ray.intersectsSphere(kd)===!1)return;Dd.copy(r).invert(),Od.copy(e.ray).applyMatrix4(Dd);let o=i/((this.scale.x+this.scale.y+this.scale.z)/3),s=o*o,c=this.isLineSegments?2:1,l=n.index,u=n.attributes.position;if(l!==null){let n=Math.max(0,a.start),r=Math.min(l.count,a.start+a.count);for(let i=n,a=r-1;i<a;i+=c){let n=l.getX(i),r=l.getX(i+1),a=Nd(this,e,Od,s,n,r,i);a&&t.push(a)}if(this.isLineLoop){let i=l.getX(r-1),a=l.getX(n),o=Nd(this,e,Od,s,i,a,r-1);o&&t.push(o)}}else{let n=Math.max(0,a.start),r=Math.min(u.count,a.start+a.count);for(let i=n,a=r-1;i<a;i+=c){let n=Nd(this,e,Od,s,i,i+1,i);n&&t.push(n)}if(this.isLineLoop){let i=Nd(this,e,Od,s,r-1,n,r-1);i&&t.push(i)}}}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}};function Nd(e,t,n,r,i,a,o){let s=e.geometry.attributes.position;if(Td.fromBufferAttribute(s,i),Ed.fromBufferAttribute(s,a),n.distanceSqToSegment(Td,Ed,Ad,jd)>r)return;Ad.applyMatrix4(e.matrixWorld);let c=t.ray.origin.distanceTo(Ad);if(!(c<t.near||c>t.far))return{distance:c,point:jd.clone().applyMatrix4(e.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:e}}var Pd=new q,Fd=new q,Id=class extends Md{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type=`LineSegments`}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let e=0,r=t.count;e<r;e+=2)Pd.fromBufferAttribute(t,e),Fd.fromBufferAttribute(t,e+1),n[e]=e===0?0:n[e-1],n[e+1]=n[e]+Pd.distanceTo(Fd);e.setAttribute(`lineDistance`,new cu(n,1))}else H(`LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.`);return this}},Ld=class extends Md{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type=`LineLoop`}},Rd=class extends ku{constructor(e){super(),this.isPointsMaterial=!0,this.type=`PointsMaterial`,this.color=new Y(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},zd=new J,Bd=new Pu,Vd=new fu,Hd=new q,Ud=class extends gl{constructor(e=new bu,t=new Rd){super(),this.isPoints=!0,this.type=`Points`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.matrixWorld,i=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Vd.copy(n.boundingSphere),Vd.applyMatrix4(r),Vd.radius+=i,e.ray.intersectsSphere(Vd)===!1)return;zd.copy(r).invert(),Bd.copy(e.ray).applyMatrix4(zd);let o=i/((this.scale.x+this.scale.y+this.scale.z)/3),s=o*o,c=n.index,l=n.attributes.position;if(c!==null){let n=Math.max(0,a.start),i=Math.min(c.count,a.start+a.count);for(let a=n,o=i;a<o;a++){let n=c.getX(a);Hd.fromBufferAttribute(l,n),Wd(Hd,n,s,r,e,t,this)}}else{let n=Math.max(0,a.start),i=Math.min(l.count,a.start+a.count);for(let a=n,o=i;a<o;a++)Hd.fromBufferAttribute(l,a),Wd(Hd,a,s,r,e,t,this)}}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}};function Wd(e,t,n,r,i,a,o){let s=Bd.distanceSqToPoint(e);if(s<n){let n=new q;Bd.closestPointToPoint(e,n),n.applyMatrix4(r);let c=i.ray.origin.distanceTo(n);if(c<i.near||c>i.far)return;a.push({distance:c,distanceToRay:Math.sqrt(s),point:n,index:t,face:null,faceIndex:null,barycoord:null,object:o})}}var Gd=class extends ku{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type=`MeshStandardMaterial`,this.defines={STANDARD:``},this.color=new Y(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Y(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new K(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new $c,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:``},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Kd=class extends Gd{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:``,PHYSICAL:``},this.type=`MeshPhysicalMaterial`,this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new K(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return W(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Y(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Y(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Y(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(e){this._retroreflectivity>0!=e>0&&this.version++,this._retroreflectivity=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:``,PHYSICAL:``},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.retroreflectivity=e.retroreflectivity,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},qd=class extends ku{constructor(e){super(),this.isMeshPhongMaterial=!0,this.type=`MeshPhongMaterial`,this.color=new Y(16777215),this.specular=new Y(1118481),this.shininess=30,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Y(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new K(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new $c,this.combine=0,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.specular.copy(e.specular),this.shininess=e.shininess,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.envMapIntensity=e.envMapIntensity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}};function Jd(e,t){return!e||e.constructor===t?e:typeof t.BYTES_PER_ELEMENT==`number`?new t(e):Array.prototype.slice.call(e)}function Yd(e){return e!==void 0&&e.inTangents!==void 0&&e.outTangents!==void 0}function Xd(e){function t(t,n){return e[t]-e[n]}let n=e.length,r=Array(n);for(let e=0;e!==n;++e)r[e]=e;return r.sort(t),r}function Zd(e,t,n){let r=e.length,i=new e.constructor(r);for(let a=0,o=0;o!==r;++a){let r=n[a]*t;for(let n=0;n!==t;++n)i[o++]=e[r+n]}return i}function Qd(e,t,n,r){let i=1,a=e[0];for(;a!==void 0&&a[r]===void 0;)a=e[i++];if(a===void 0)return;let o=a[r];if(o!==void 0){if(Array.isArray(o))do o=a[r],o!==void 0&&(t.push(a.time),n.push(...o)),a=e[i++];while(a!==void 0);else if(o.toArray!==void 0)do o=a[r],o!==void 0&&(t.push(a.time),o.toArray(n,n.length)),a=e[i++];while(a!==void 0);else do o=a[r],o!==void 0&&(t.push(a.time),n.push(o)),a=e[i++];while(a!==void 0)}}var $d=class{constructor(e,t,n,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r===void 0?new t.constructor(n):r,this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,r=t[n],i=t[n-1];validate_interval:{seek:{let a;linear_scan:{forward_scan:if(!(e<r)){for(let a=n+2;;){if(r===void 0){if(e<i)break forward_scan;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(i=r,r=t[++n],e<r)break seek}a=t.length;break linear_scan}if(!(e>=i)){let o=t[1];e<o&&(n=2,i=o);for(let a=n-2;;){if(i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===a)break;if(r=i,i=t[--n-1],e>=i)break seek}a=n,n=0;break linear_scan}break validate_interval}for(;n<a;){let r=n+a>>>1;e<t[r]?a=r:n=r+1}if(r=t[n],i=t[n-1],i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,i,r)}return this.interpolate_(n,i,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,r=this.valueSize,i=e*r;for(let e=0;e!==r;++e)t[e]=n[i+e];return t}interpolate_(){throw Error(`THREE.Interpolant: Call to abstract method.`)}intervalChanged_(){}},ef=class extends $d{constructor(e,t,n,r){super(e,t,n,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Ps,endingEnd:Ps}}intervalChanged_(e,t,n){let r=this.parameterPositions,i=e-2,a=e+1,o=r[i],s=r[a];if(o===void 0)switch(this.getSettings_().endingStart){case Fs:i=e,o=2*t-n;break;case Is:i=r.length-2,o=t+r[i]-r[i+1];break;default:i=e,o=n}if(s===void 0)switch(this.getSettings_().endingEnd){case Fs:a=e,s=2*n-t;break;case Is:a=1,s=n+r[1]-r[0];break;default:a=e-1,s=t}let c=(n-t)*.5,l=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(s-n),this._offsetPrev=i*l,this._offsetNext=a*l}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,p=(n-t)/(r-t),m=p*p,h=m*p,g=-d*h+2*d*m-d*p,_=(1+d)*h+(-1.5-2*d)*m+(-.5+d)*p+1,v=(-1-f)*h+(1.5+f)*m+.5*p,y=f*h-f*m;for(let e=0;e!==o;++e)i[e]=g*a[l+e]+_*a[c+e]+v*a[s+e]+y*a[u+e];return i}},tf=class extends $d{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=(n-t)/(r-t),u=1-l;for(let e=0;e!==o;++e)i[e]=a[c+e]*u+a[s+e]*l;return i}},nf=class extends $d{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e){return this.copySampleValue_(e-1)}},rf=class extends $d{interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this.inTangents,u=this.outTangents;if(!l||!u){let e=(n-t)/(r-t),l=1-e;for(let t=0;t!==o;++t)i[t]=a[c+t]*l+a[s+t]*e;return i}let d=o*2,f=e-1;for(let p=0;p!==o;++p){let o=a[c+p],m=a[s+p],h=f*d+p*2,g=u[h],_=u[h+1],v=e*d+p*2,y=l[v],b=l[v+1],x=sf(n,t,g,y,r);i[p]=af(x,o,_,b,m)}return i}};function af(e,t,n,r,i){let a=1-e;return a*a*a*t+3*a*a*e*n+3*a*e*e*r+e*e*e*i}function of(e,t,n,r,i){let a=1-e;return 3*a*a*(n-t)+6*a*e*(r-n)+3*e*e*(i-r)}function sf(e,t,n,r,i){let a=(e-t)/(i-t);for(let o=0;o<8;o++){let o=af(a,t,n,r,i)-e;if(Math.abs(o)<1e-10)break;let s=of(a,t,n,r,i);if(Math.abs(s)<1e-10)break;a=Math.max(0,Math.min(1,a-o/s))}return a}var cf=class{constructor(e,t,n,r){if(e===void 0)throw Error(`THREE.KeyframeTrack: track name is undefined`);if(t===void 0||t.length===0)throw Error(`THREE.KeyframeTrack: no keyframes in track named `+e);this.name=e,this.times=Jd(t,this.TimeBufferType),this.values=Jd(n,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:Jd(e.times,Array),values:Jd(e.values,Array)};let t=e.getInterpolation();t!==e.DefaultInterpolation&&(n.interpolation=t),Yd(e.settings)&&(n.settings={inTangents:Jd(e.settings.inTangents,Array),outTangents:Jd(e.settings.outTangents,Array)})}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new nf(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new tf(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new ef(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new rf(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case As:t=this.InterpolantFactoryMethodDiscrete;break;case js:t=this.InterpolantFactoryMethodLinear;break;case Ms:t=this.InterpolantFactoryMethodSmooth;break;case Ns:t=this.InterpolantFactoryMethodBezier}if(t===void 0){let t=`unsupported interpolation for `+this.ValueTypeName+` keyframe track named `+this.name;if(this.createInterpolant===void 0){if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw Error(t)}return H(`KeyframeTrack:`,t),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return As;case this.InterpolantFactoryMethodLinear:return js;case this.InterpolantFactoryMethodSmooth:return Ms;case this.InterpolantFactoryMethodBezier:return Ns}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]*=e;Yd(this.settings)&&(lf(this.settings.inTangents,e),lf(this.settings.outTangents,e))}return this}trim(e,t){let n=this.times,r=n.length,i=0,a=r-1;for(;i!==r&&n[i]<e;)++i;for(;a!==-1&&n[a]>t;)--a;if(++a,i!==0||a!==r){i>=a&&(a=Math.max(a,1),i=a-1);let e=this.getValueSize();this.times=n.slice(i,a),this.values=this.values.slice(i*e,a*e)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(U(`KeyframeTrack: Invalid value size in track.`,this),e=!1);let n=this.times,r=this.values,i=n.length;i===0&&(U(`KeyframeTrack: Track is empty.`,this),e=!1);let a=null;for(let t=0;t!==i;t++){let r=n[t];if(typeof r==`number`&&isNaN(r)){U(`KeyframeTrack: Time is not a valid number.`,this,t,r),e=!1;break}if(a!==null&&a>r){U(`KeyframeTrack: Out of order keys.`,this,t,r,a),e=!1;break}a=r}if(r!==void 0&&Ks(r))for(let t=0,n=r.length;t!==n;++t){let n=r[t];if(isNaN(n)){U(`KeyframeTrack: Value is not a valid number.`,this,t,n),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),r=this.getInterpolation()===Ms,i=e.length-1,a=1;for(let o=1;o<i;++o){let i=!1,s=e[o];if(s!==e[o+1]&&(o!==1||s!==e[0])){if(r)i=!0;else{let e=o*n,r=e-n,a=e+n;for(let o=0;o!==n;++o){let n=t[e+o];if(n!==t[r+o]||n!==t[a+o]){i=!0;break}}}}if(i){if(o!==a){e[a]=e[o];let r=o*n,i=a*n;for(let e=0;e!==n;++e)t[i+e]=t[r+e]}++a}}if(i>0){e[a]=e[i];for(let e=i*n,r=a*n,o=0;o!==n;++o)t[r+o]=t[e+o];++a}return a===e.length?(this.times=e,this.values=t):(this.times=e.slice(0,a),this.values=t.slice(0,a*n)),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,r=new n(this.name,e,t);return r.createInterpolant=this.createInterpolant,Yd(this.settings)&&(r.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),r}};function lf(e,t){for(let n=0,r=e.length;n!==r;n+=2)e[n]*=t}cf.prototype.ValueTypeName=``,cf.prototype.TimeBufferType=Float32Array,cf.prototype.ValueBufferType=Float32Array,cf.prototype.DefaultInterpolation=js;var uf=class extends cf{constructor(e,t,n){super(e,t,n)}};uf.prototype.ValueTypeName=`bool`,uf.prototype.ValueBufferType=Array,uf.prototype.DefaultInterpolation=As,uf.prototype.InterpolantFactoryMethodLinear=void 0,uf.prototype.InterpolantFactoryMethodSmooth=void 0;var df=class extends cf{constructor(e,t,n,r){super(e,t,n,r)}};df.prototype.ValueTypeName=`color`;var ff=class extends cf{constructor(e,t,n,r){super(e,t,n,r)}};ff.prototype.ValueTypeName=`number`;var pf=class extends $d{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=(n-t)/(r-t),c=e*o;for(let e=c+o;c!==e;c+=4)wc.slerpFlat(i,0,a,c-o,a,c,s);return i}},mf=class extends cf{constructor(e,t,n,r){super(e,t,n,r)}InterpolantFactoryMethodLinear(e){return new pf(this.times,this.values,this.getValueSize(),e)}};mf.prototype.ValueTypeName=`quaternion`,mf.prototype.InterpolantFactoryMethodSmooth=void 0;var hf=class extends cf{constructor(e,t,n){super(e,t,n)}};hf.prototype.ValueTypeName=`string`,hf.prototype.ValueBufferType=Array,hf.prototype.DefaultInterpolation=As,hf.prototype.InterpolantFactoryMethodLinear=void 0,hf.prototype.InterpolantFactoryMethodSmooth=void 0;var gf=class extends cf{constructor(e,t,n,r){super(e,t,n,r)}};gf.prototype.ValueTypeName=`vector`;var _f=class{constructor(e=``,t=-1,n=[],r=Ls){this.name=e,this.tracks=n,this.duration=t,this.blendMode=r,this.uuid=rc(),this.userData={},this.duration<0&&this.resetDuration()}static parse(e){let t=[],n=e.tracks,r=1/(e.fps||1);for(let e=0,i=n.length;e!==i;++e)t.push(yf(n[e]).scale(r));let i=new this(e.name,e.duration,t,e.blendMode);return i.uuid=e.uuid,i.userData=JSON.parse(e.userData||`{}`),i}static toJSON(e){let t=[],n=e.tracks,r={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode,userData:JSON.stringify(e.userData)};for(let e=0,r=n.length;e!==r;++e)t.push(cf.toJSON(n[e]));return r}static CreateFromMorphTargetSequence(e,t,n,r){let i=t.length,a=[];for(let e=0;e<i;e++){let o=[],s=[];o.push((e+i-1)%i,e,(e+1)%i),s.push(0,1,0);let c=Xd(o);o=Zd(o,1,c),s=Zd(s,1,c),!r&&o[0]===0&&(o.push(i),s.push(s[0])),a.push(new ff(`.morphTargetInfluences[`+t[e].name+`]`,o,s).scale(1/n))}return new this(e,-1,a)}static findByName(e,t){let n=e;if(!Array.isArray(e)){let t=e;n=t.geometry&&t.geometry.animations||t.animations}for(let e=0;e<n.length;e++)if(n[e].name===t)return n[e];return null}static CreateClipsFromMorphTargetSequences(e,t,n){let r={},i=/^([\w-]*?)([\d]+)$/;for(let t=0,n=e.length;t<n;t++){let n=e[t],a=n.name.match(i);if(a&&a.length>1){let e=a[1],t=r[e];t||(r[e]=t=[]),t.push(n)}}let a=[];for(let e in r)a.push(this.CreateFromMorphTargetSequence(e,r[e],t,n));return a}resetDuration(){let e=this.tracks,t=0;for(let n=0,r=e.length;n!==r;++n){let e=this.tracks[n];t=Math.max(t,e.times[e.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e&&=this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){let e=[];for(let t=0;t<this.tracks.length;t++)e.push(this.tracks[t].clone());let t=new this.constructor(this.name,this.duration,e,this.blendMode);return t.userData=JSON.parse(JSON.stringify(this.userData)),t}toJSON(){return this.constructor.toJSON(this)}};function vf(e){switch(e.toLowerCase()){case`scalar`:case`double`:case`float`:case`number`:case`integer`:return ff;case`vector`:case`vector2`:case`vector3`:case`vector4`:return gf;case`color`:return df;case`quaternion`:return mf;case`bool`:case`boolean`:return uf;case`string`:return hf}throw Error(`THREE.KeyframeTrack: Unsupported typeName: `+e)}function yf(e){if(e.type===void 0)throw Error(`THREE.KeyframeTrack: track type undefined, can not parse`);let t=vf(e.type);if(e.times===void 0){let t=[],n=[];Qd(e.keys,t,n,`value`),e.times=t,e.values=n}let n;return n=t.parse===void 0?new t(e.name,e.times,e.values,e.interpolation):t.parse(e),Yd(e.settings)&&(n.settings={inTangents:Jd(e.settings.inTangents,Float32Array),outTangents:Jd(e.settings.outTangents,Float32Array)}),n}var bf={enabled:!1,files:{},add:function(e,t){this.enabled!==!1&&(xf(e)||(this.files[e]=t))},get:function(e){if(this.enabled!==!1&&!xf(e))return this.files[e]},remove:function(e){delete this.files[e]},clear:function(){this.files={}}};function xf(e){try{let t=e.slice(e.indexOf(`:`)+1);return new URL(t).protocol===`blob:`}catch{return!1}}var Sf=new class{constructor(e,t,n){let r=this,i=!1,a=0,o=0,s,c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this._abortController=null,this.itemStart=function(e){o++,i===!1&&r.onStart!==void 0&&r.onStart(e,a,o),i=!0},this.itemEnd=function(e){a++,r.onProgress!==void 0&&r.onProgress(e,a,o),a===o&&(i=!1,r.onLoad!==void 0&&r.onLoad())},this.itemError=function(e){r.onError!==void 0&&r.onError(e)},this.resolveURL=function(e){return e=e.normalize(`NFC`),s?s(e):e},this.setURLModifier=function(e){return s=e,this},this.addHandler=function(e,t){return c.push(e,t),this},this.removeHandler=function(e){let t=c.indexOf(e);return t!==-1&&c.splice(t,2),this},this.getHandler=function(e){for(let t=0,n=c.length;t<n;t+=2){let n=c[t],r=c[t+1];if(n.global&&(n.lastIndex=0),n.test(e))return r}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||=new AbortController,this._abortController}},Cf=class{constructor(e){this.manager=e===void 0?Sf:e,this.crossOrigin=`anonymous`,this.withCredentials=!1,this.path=``,this.resourcePath=``,this.requestHeader={},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}load(){}loadAsync(e,t){let n=this;return new Promise(function(r,i){n.load(e,r,t,i)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}};Cf.DEFAULT_MATERIAL_NAME=`__DEFAULT`;var wf={},Tf=class extends Error{constructor(e,t){super(e),this.response=t}},Ef=class extends Cf{constructor(e){super(e),this.mimeType=``,this.responseType=``,this._abortController=new AbortController}load(e,t,n,r){e===void 0&&(e=``),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let i=bf.get(`file:${e}`);if(i!==void 0){this.manager.itemStart(e),setTimeout(()=>{t&&t(i),this.manager.itemEnd(e)},0);return}if(wf[e]!==void 0){wf[e].push({onLoad:t,onProgress:n,onError:r});return}wf[e]=[],wf[e].push({onLoad:t,onProgress:n,onError:r});let a=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?`include`:`same-origin`,signal:typeof AbortSignal.any==`function`?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),o=this.mimeType,s=this.responseType;fetch(a).then(t=>{if(t.status===200||t.status===0){if(t.status===0&&H(`FileLoader: HTTP Status 0 received.`),typeof ReadableStream>`u`||t.body===void 0||t.body.getReader===void 0)return t;let n=wf[e],r=t.body.getReader(),i=t.headers.get(`X-File-Size`)||t.headers.get(`Content-Length`),a=i?parseInt(i):0,o=a!==0,s=0,c=new ReadableStream({start(e){t();function t(){r.read().then(({done:r,value:i})=>{if(r)e.close();else{s+=i.byteLength;let r=new ProgressEvent(`progress`,{lengthComputable:o,loaded:s,total:a});for(let e=0,t=n.length;e<t;e++){let t=n[e];t.onProgress&&t.onProgress(r)}e.enqueue(i),t()}},t=>{e.error(t)})}}});return new Response(c)}throw new Tf(`fetch for "${t.url}" responded with ${t.status}: ${t.statusText}`,t)}).then(e=>{switch(s){case`arraybuffer`:return e.arrayBuffer();case`blob`:return e.blob();case`document`:return e.text().then(e=>new DOMParser().parseFromString(e,o));case`json`:return e.json();default:if(o===``)return e.text();{let t=/charset="?([^;"\s]*)"?/i.exec(o),n=t&&t[1]?t[1].toLowerCase():void 0,r=new TextDecoder(n);return e.arrayBuffer().then(e=>r.decode(e))}}}).then(t=>{bf.add(`file:${e}`,t);let n=wf[e];delete wf[e];for(let e=0,r=n.length;e<r;e++){let r=n[e];r.onLoad&&r.onLoad(t)}}).catch(t=>{let n=wf[e];if(n===void 0)throw this.manager.itemError(e),t;delete wf[e];for(let e=0,r=n.length;e<r;e++){let r=n[e];r.onError&&r.onError(t)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},Df=new WeakMap,Of=class extends Cf{constructor(e){super(e)}load(e,t,n,r){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let i=this,a=bf.get(`image:${e}`);if(a!==void 0){if(a.complete===!0)i.manager.itemStart(e),setTimeout(function(){t&&t(a),i.manager.itemEnd(e)},0);else{let e=Df.get(a);e===void 0&&(e=[],Df.set(a,e)),e.push({onLoad:t,onError:r})}return a}let o=qs(`img`);function s(){l(),t&&t(this);let n=Df.get(this)||[];for(let e=0;e<n.length;e++){let t=n[e];t.onLoad&&t.onLoad(this)}Df.delete(this),i.manager.itemEnd(e)}function c(t){l(),r&&r(t),bf.remove(`image:${e}`);let n=Df.get(this)||[];for(let e=0;e<n.length;e++){let r=n[e];r.onError&&r.onError(t)}Df.delete(this),i.manager.itemError(e),i.manager.itemEnd(e)}function l(){o.removeEventListener(`load`,s,!1),o.removeEventListener(`error`,c,!1)}return o.addEventListener(`load`,s,!1),o.addEventListener(`error`,c,!1),e.slice(0,5)!==`data:`&&this.crossOrigin!==void 0&&(o.crossOrigin=this.crossOrigin),bf.add(`image:${e}`,o),i.manager.itemStart(e),o.src=e,o}},kf=class extends Cf{constructor(e){super(e)}load(e,t,n,r){let i=this,a=new sd,o=new Ef(this.manager);return o.setResponseType(`arraybuffer`),o.setRequestHeader(this.requestHeader),o.setPath(this.path),o.setWithCredentials(i.withCredentials),o.load(e,function(e){let n;try{n=i.parse(e)}catch(e){r===void 0?U(e):r(e);return}i._applyTexData(a,n),t&&t(a,n)},n,r),a}createDataTexture(e){let t=new sd;return this._applyTexData(t,this.parse(e)),t}_applyTexData(e,t){t.image===void 0?t.data!==void 0&&(e.image.width=t.width,e.image.height=t.height,e.image.data=t.data):e.image=t.image,e.wrapS=t.wrapS===void 0?gs:t.wrapS,e.wrapT=t.wrapT===void 0?gs:t.wrapT,e.magFilter=t.magFilter===void 0?xs:t.magFilter,e.minFilter=t.minFilter===void 0?xs:t.minFilter,e.anisotropy=t.anisotropy===void 0?1:t.anisotropy,t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.mipmaps!==void 0&&(e.mipmaps=t.mipmaps,e.minFilter=Cs),t.mipmapCount===1&&(e.minFilter=xs),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),e.needsUpdate=!0}},Af=class extends Cf{constructor(e){super(e)}load(e,t,n,r){let i=new Hc,a=new Of(this.manager);return a.setCrossOrigin(this.crossOrigin),a.setPath(this.path),a.load(e,function(e){i.image=e,i.needsUpdate=!0,t!==void 0&&t(i)},n,r),i}},jf=class extends gl{constructor(e,t=1){super(),this.isLight=!0,this.type=`Light`,this.color=new Y(e),this.intensity=t}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},Mf=new J,Nf=new q,Pf=new q,Ff=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new K(512,512),this.mapType=ws,this.map=null,this.mapPass=null,this.matrix=new J,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Cd,this._frameExtents=new K(1,1),this._viewportCount=1,this._viewports=[new Uc(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera;Nf.setFromMatrixPosition(e.matrixWorld),t.position.copy(Nf),Pf.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Pf),t.updateMatrixWorld(),this._updateMatrix(t,this.matrix,this._frustum)}_updateMatrix(e,t,n,r){Mf.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),n.setFromProjectionMatrix(Mf,e.coordinateSystem,e.reversedDepth);let i=this._frameExtents,a=r?r.z/i.x:1,o=r?r.w/i.y:1,s=r?r.x/i.x:0,c=r?r.y/i.y:0;e.coordinateSystem===2001||e.reversedDepth?t.set(.5*a,0,0,.5*a+s,0,.5*o,0,.5*o+c,0,0,1,0,0,0,0,1):t.set(.5*a,0,0,.5*a+s,0,.5*o,0,.5*o+c,0,0,.5,.5,0,0,0,1),t.multiply(Mf)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return e.intensity=this.intensity,e.bias=this.bias,e.normalBias=this.normalBias,e.radius=this.radius,e.blurSamples=this.blurSamples,e.mapSize=this.mapSize.toArray(),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},If=new q,Lf=new wc,Rf=new q,zf=class extends gl{constructor(){super(),this.isCamera=!0,this.type=`Camera`,this.matrixWorldInverse=new J,this.projectionMatrix=new J,this.projectionMatrixInverse=new J,this.coordinateSystem=Ws,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(If,Lf,Rf),Rf.x===1&&Rf.y===1&&Rf.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(If,Lf,Rf.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(If,Lf,Rf),Rf.x===1&&Rf.y===1&&Rf.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(If,Lf,Rf.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Bf=new q,Vf=new K,Hf=new K,Uf=class extends zf{constructor(e=50,t=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type=`PerspectiveCamera`,this.fov=e,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=nc*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(tc*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return nc*2*Math.atan(Math.tan(tc*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Bf.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Bf.x,Bf.y).multiplyScalar(-e/Bf.z),Bf.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Bf.x,Bf.y).multiplyScalar(-e/Bf.z)}getViewSize(e,t){return this.getViewBounds(e,Vf,Hf),t.subVectors(Hf,Vf)}setViewOffset(e,t,n,r,i,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(tc*.5*this.fov)/this.zoom,n=2*t,r=this.aspect*n,i=-.5*r,a=this.view;if(this.view!==null&&this.view.enabled){let e=a.fullWidth,o=a.fullHeight;i+=a.offsetX*r/e,t-=a.offsetY*n/o,r*=a.width/e,n*=a.height/o}let o=this.filmOffset;o!==0&&(i+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(i,i+r,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},Wf=class extends Ff{constructor(){super(new Uf(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=nc*2*e.angle*this.focus,r=this.mapSize.width/this.mapSize.height*this.aspect,i=e.distance||t.far;(n!==t.fov||r!==t.aspect||i!==t.far)&&(t.fov=n,t.aspect=r,t.far=i,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this.aspect=e.aspect,this}toJSON(){let e=super.toJSON();return e.focus=this.focus,e.aspect=this.aspect,e}},Gf=class extends jf{constructor(e,t,n=0,r=Math.PI/3,i=0,a=2){super(e,t),this.isSpotLight=!0,this.type=`SpotLight`,this.position.copy(gl.DEFAULT_UP),this.updateMatrix(),this.target=new gl,this.distance=n,this.angle=r,this.penumbra=i,this.decay=a,this.map=null,this.shadow=new Wf}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.map=e.map,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.angle=this.angle,t.object.decay=this.decay,t.object.penumbra=this.penumbra,t.object.target=this.target.uuid,this.map&&this.map.isTexture&&(t.object.map=this.map.toJSON(e).uuid),t.object.shadow=this.shadow.toJSON(),t}},Kf=class extends Ff{constructor(){super(new Uf(90,1,.5,500)),this.isPointLightShadow=!0}},qf=class extends jf{constructor(e,t,n=0,r=2){super(e,t),this.isPointLight=!0,this.type=`PointLight`,this.distance=n,this.decay=r,this.shadow=new Kf}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.decay=this.decay,t.object.shadow=this.shadow.toJSON(),t}},Jf=class extends zf{constructor(e=-1,t=1,n=1,r=-1,i=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type=`OrthographicCamera`,this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=r,this.near=i,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,r,i,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,r=(this.top+this.bottom)/2,i=n-e,a=n+e,o=r+t,s=r-t;if(this.view!==null&&this.view.enabled){let e=(this.right-this.left)/this.view.fullWidth/this.zoom,t=(this.top-this.bottom)/this.view.fullHeight/this.zoom;i+=e*this.view.offsetX,a=i+e*this.view.width,o-=t*this.view.offsetY,s=o-t*this.view.height}this.projectionMatrix.makeOrthographic(i,a,o,s,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Yf=class extends Ff{constructor(){super(new Jf(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Xf=class extends jf{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type=`DirectionalLight`,this.position.copy(gl.DEFAULT_UP),this.updateMatrix(),this.target=new gl,this.shadow=new Yf}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}},Zf=class{static extractUrlBase(e){let t=e.lastIndexOf(`/`);return t===-1?`./`:e.slice(0,t+1)}static resolveURL(e,t){return typeof e!=`string`||e===``?``:(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,`$1`)),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}},Qf=new WeakMap,$f=class extends Cf{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>`u`&&H(`ImageBitmapLoader: createImageBitmap() not supported.`),typeof fetch>`u`&&H(`ImageBitmapLoader: fetch() not supported.`),this.options={premultiplyAlpha:`none`},this._abortController=new AbortController}setOptions(e){return this.options=e,this}load(e,t,n,r){e===void 0&&(e=``),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);let i=this,a=bf.get(`image-bitmap:${e}`);if(a!==void 0){if(i.manager.itemStart(e),a.then){a.then(n=>{Qf.has(a)===!0?(r&&r(Qf.get(a)),i.manager.itemError(e),i.manager.itemEnd(e)):(t&&t(n),i.manager.itemEnd(e))});return}setTimeout(function(){t&&t(a),i.manager.itemEnd(e)},0);return}let o={};o.credentials=this.crossOrigin===`anonymous`?`same-origin`:`include`,o.headers=this.requestHeader,o.signal=typeof AbortSignal.any==`function`?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;let s=fetch(e,o).then(function(e){return e.blob()}).then(function(e){return createImageBitmap(e,Object.assign({},i.options,{colorSpaceConversion:`none`}))}).then(function(n){return bf.add(`image-bitmap:${e}`,n),t&&t(n),i.manager.itemEnd(e),n}).catch(function(t){r&&r(t),Qf.set(s,t),bf.remove(`image-bitmap:${e}`),i.manager.itemError(e),i.manager.itemEnd(e)});bf.add(`image-bitmap:${e}`,s),i.manager.itemStart(e)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}},ep=`\\[\\]\\.:\\/`,tp=RegExp(`[\\[\\]\\.:\\/]`,`g`),np=`[^\\[\\]\\.:\\/]`,rp=`[^`+ep.replace(`\\.`,``)+`]`,ip=`((?:WC+[\\/:])*)`.replace(`WC`,np),ap=`(WCOD+)?`.replace(`WCOD`,rp),op=`(?:\\.(WC+)(?:\\[(.+)\\])?)?`.replace(`WC`,np),sp=`\\.(WC+)(?:\\[(.+)\\])?`.replace(`WC`,np),cp=RegExp(`^`+ip+ap+op+sp+`$`),lp=[`material`,`materials`,`bones`,`map`],up=class{constructor(e,t,n){let r=n||Z.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,r=this._bindings[n];r!==void 0&&r.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let r=this._targetGroup.nCachedObjects_,i=n.length;r!==i;++r)n[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},Z=class e{constructor(t,n,r){this.path=n,this.parsedPath=r||e.parseTrackName(n),this.node=e.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,n,r){return t&&t.isAnimationObjectGroup?new e.Composite(t,n,r):new e(t,n,r)}static sanitizeNodeName(e){return e.replace(/\s/g,`_`).replace(tp,``)}static parseTrackName(e){let t=cp.exec(e);if(t===null)throw Error(`THREE.PropertyBinding: Cannot parse trackName: `+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=n.nodeName&&n.nodeName.lastIndexOf(`.`);if(r!==void 0&&r!==-1){let e=n.nodeName.substring(r+1);lp.indexOf(e)!==-1&&(n.nodeName=n.nodeName.substring(0,r),n.objectName=e)}if(n.propertyName===null||n.propertyName.length===0)throw Error(`THREE.PropertyBinding: can not parse propertyName from trackName: `+e);return n}static findNode(e,t){if(t===void 0||t===``||t===`.`||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(e){for(let r=0;r<e.length;r++){let i=e[r];if(i.name===t||i.uuid===t)return i;let a=n(i.children);if(a)return a}return null},r=n(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)e[t++]=n[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let t=this.node,n=this.parsedPath,r=n.objectName,i=n.propertyName,a=n.propertyIndex;if(t||(t=e.findNode(this.rootNode,n.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){H(`PropertyBinding: No target node found for track: `+this.path+`.`);return}if(r){let e=n.objectIndex;switch(r){case`materials`:if(!t.material){U(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.materials){U(`PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.`,this);return}t=t.material.materials;break;case`bones`:if(!t.skeleton){U(`PropertyBinding: Can not bind to bones as node does not have a skeleton.`,this);return}t=t.skeleton.bones;for(let n=0;n<t.length;n++)if(t[n].name===e){e=n;break}break;case`map`:if(`map`in t){t=t.map;break}if(!t.material){U(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.map){U(`PropertyBinding: Can not bind to material.map as node.material does not have a map.`,this);return}t=t.material.map;break;default:if(t[r]===void 0){U(`PropertyBinding: Can not bind to objectName of node undefined.`,this);return}t=t[r]}if(e!==void 0){if(t[e]===void 0){U(`PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.`,this,t);return}t=t[e]}}let o=t[i];if(o===void 0){let e=n.nodeName;U(`PropertyBinding: Trying to update property for track: `+e+`.`+i+` but it wasn't found.`,t);return}let s=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?s=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(s=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(a!==void 0){if(i===`morphTargetInfluences`){if(!t.geometry){U(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.`,this);return}if(!t.geometry.morphAttributes){U(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.`,this);return}t.morphTargetDictionary[a]!==void 0&&(a=t.morphTargetDictionary[a])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=a}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][s]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};Z.Composite=up,Z.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3},Z.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2},Z.prototype.GetterByBindingType=[Z.prototype._getValue_direct,Z.prototype._getValue_array,Z.prototype._getValue_arrayElement,Z.prototype._getValue_toArray],Z.prototype.SetterByBindingTypeAndVersioning=[[Z.prototype._setValue_direct,Z.prototype._setValue_direct_setNeedsUpdate,Z.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Z.prototype._setValue_array,Z.prototype._setValue_array_setNeedsUpdate,Z.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Z.prototype._setValue_arrayElement,Z.prototype._setValue_arrayElement_setNeedsUpdate,Z.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Z.prototype._setValue_fromArray,Z.prototype._setValue_fromArray_setNeedsUpdate,Z.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]],class e{static{e.prototype.isMatrix2=!0}constructor(e,t,n,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,r){let i=this.elements;return i[0]=e,i[2]=t,i[1]=n,i[3]=r,this}},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`register`,{detail:{revision:`186`}})),typeof window<`u`&&(window.__THREE__?H(`WARNING: Multiple instances of Three.js being imported.`):window.__THREE__=`186`);function dp(e,t){if(t===0)return console.warn(`THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles.`),e;if(t===2||t===1){let n=e.getIndex();if(n===null){let t=[],r=e.getAttribute(`position`);if(r!==void 0){for(let e=0;e<r.count;e++)t.push(e);e.setIndex(t),n=e.getIndex()}else return console.error(`THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible.`),e}let r=n.count-2,i=[];if(t===2)for(let e=1;e<=r;e++)i.push(n.getX(0)),i.push(n.getX(e)),i.push(n.getX(e+1));else for(let e=0;e<r;e++)e%2==0?(i.push(n.getX(e)),i.push(n.getX(e+1)),i.push(n.getX(e+2))):(i.push(n.getX(e+2)),i.push(n.getX(e+1)),i.push(n.getX(e)));return i.length/3!==r&&console.error(`THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.`),e.setIndex(i),e.clearGroups(),e}return console.error(`THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:`,t),e}function fp(e){let t=new Map,n=new Map,r=e.clone();return pp(e,r,function(e,r){t.set(r,e),n.set(e,r)}),r.traverse(function(e){if(!e.isSkinnedMesh)return;let r=e,i=t.get(e),a=i.skeleton.bones;r.skeleton=i.skeleton.clone(),r.bindMatrix.copy(i.bindMatrix),r.skeleton.bones=a.map(function(e){return n.get(e)}),r.bind(r.skeleton,r.bindMatrix)}),r}function pp(e,t,n){n(e,t);for(let r=0;r<e.children.length;r++)pp(e.children[r],t.children[r],n)}var mp=class extends Cf{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(e){return new yp(e)}),this.register(function(e){return new bp(e)}),this.register(function(e){return new kp(e)}),this.register(function(e){return new Ap(e)}),this.register(function(e){return new jp(e)}),this.register(function(e){return new Sp(e)}),this.register(function(e){return new Cp(e)}),this.register(function(e){return new wp(e)}),this.register(function(e){return new Tp(e)}),this.register(function(e){return new vp(e)}),this.register(function(e){return new Ep(e)}),this.register(function(e){return new xp(e)}),this.register(function(e){return new Op(e)}),this.register(function(e){return new Dp(e)}),this.register(function(e){return new gp(e)}),this.register(function(e){return new Mp(e,$.EXT_MESHOPT_COMPRESSION)}),this.register(function(e){return new Mp(e,$.KHR_MESHOPT_COMPRESSION)}),this.register(function(e){return new Np(e)})}load(e,t,n,r){let i=this,a;if(this.resourcePath!==``)a=this.resourcePath;else if(this.path!==``){let t=Zf.extractUrlBase(e);a=Zf.resolveURL(t,this.path)}else a=Zf.extractUrlBase(e);this.manager.itemStart(e);let o=function(t){r?r(t):console.error(t),i.manager.itemError(e),i.manager.itemEnd(e)},s=new Ef(this.manager);s.setPath(this.path),s.setResponseType(`arraybuffer`),s.setRequestHeader(this.requestHeader),s.setWithCredentials(this.withCredentials),s.load(e,function(n){try{i.parse(n,a,function(n){t(n),i.manager.itemEnd(e)},o)}catch(e){o(e)}},n,o)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,r){let i,a={},o={},s=new TextDecoder;if(typeof e==`string`)i=JSON.parse(e);else if(e instanceof ArrayBuffer){if(s.decode(new Uint8Array(e,0,4))===Pp){try{a[$.KHR_BINARY_GLTF]=new Lp(e)}catch(e){r&&r(e);return}i=JSON.parse(a[$.KHR_BINARY_GLTF].content)}else i=JSON.parse(s.decode(e))}else i=e;if(i.asset===void 0||i.asset.version[0]<2){r&&r(Error(`THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported.`));return}let c=new lm(i,{path:t||this.resourcePath||``,crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});c.fileLoader.setRequestHeader(this.requestHeader);for(let e=0;e<this.pluginCallbacks.length;e++){let t=this.pluginCallbacks[e](c);t.name||console.error(`THREE.GLTFLoader: Invalid plugin found: missing name`),o[t.name]=t,a[t.name]=!0}if(i.extensionsUsed)for(let e=0;e<i.extensionsUsed.length;++e){let t=i.extensionsUsed[e],n=i.extensionsRequired||[];switch(t){case $.KHR_MATERIALS_UNLIT:a[t]=new _p;break;case $.KHR_DRACO_MESH_COMPRESSION:a[t]=new Rp(i,this.dracoLoader);break;case $.KHR_TEXTURE_TRANSFORM:a[t]=new zp;break;case $.KHR_MESH_QUANTIZATION:a[t]=new Bp;break;default:n.indexOf(t)>=0&&o[t]===void 0&&console.warn(`THREE.GLTFLoader: Unknown extension "`+t+`".`)}}c.setExtensions(a),c.setPlugins(o),c.parse(n,r)}parseAsync(e,t){let n=this;return new Promise(function(r,i){n.parse(e,t,r,i)})}};function hp(){let e={};return{get:function(t){return e[t]},add:function(t,n){e[t]=n},remove:function(t){delete e[t]},removeAll:function(){e={}}}}function Q(e,t,n){let r=e.json.materials[t];return r.extensions&&r.extensions[n]?r.extensions[n]:null}var $={KHR_BINARY_GLTF:`KHR_binary_glTF`,KHR_DRACO_MESH_COMPRESSION:`KHR_draco_mesh_compression`,KHR_LIGHTS_PUNCTUAL:`KHR_lights_punctual`,KHR_MATERIALS_CLEARCOAT:`KHR_materials_clearcoat`,KHR_MATERIALS_DISPERSION:`KHR_materials_dispersion`,KHR_MATERIALS_IOR:`KHR_materials_ior`,KHR_MATERIALS_SHEEN:`KHR_materials_sheen`,KHR_MATERIALS_SPECULAR:`KHR_materials_specular`,KHR_MATERIALS_TRANSMISSION:`KHR_materials_transmission`,KHR_MATERIALS_IRIDESCENCE:`KHR_materials_iridescence`,KHR_MATERIALS_ANISOTROPY:`KHR_materials_anisotropy`,KHR_MATERIALS_UNLIT:`KHR_materials_unlit`,KHR_MATERIALS_VOLUME:`KHR_materials_volume`,KHR_TEXTURE_BASISU:`KHR_texture_basisu`,KHR_TEXTURE_TRANSFORM:`KHR_texture_transform`,KHR_MESH_QUANTIZATION:`KHR_mesh_quantization`,KHR_MATERIALS_EMISSIVE_STRENGTH:`KHR_materials_emissive_strength`,EXT_MATERIALS_BUMP:`EXT_materials_bump`,EXT_TEXTURE_WEBP:`EXT_texture_webp`,EXT_TEXTURE_AVIF:`EXT_texture_avif`,EXT_MESHOPT_COMPRESSION:`EXT_meshopt_compression`,KHR_MESHOPT_COMPRESSION:`KHR_meshopt_compression`,EXT_MESH_GPU_INSTANCING:`EXT_mesh_gpu_instancing`},gp=class{constructor(e){this.parser=e,this.name=$.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){let e=this.parser,t=this.parser.json.nodes||[];for(let n=0,r=t.length;n<r;n++){let r=t[n];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(e){let t=this.parser,n=`light:`+e,r=t.cache.get(n);if(r)return r;let i=t.json,a=((i.extensions&&i.extensions[this.name]||{}).lights||[])[e],o,s=new Y(16777215);a.color!==void 0&&s.setRGB(a.color[0],a.color[1],a.color[2],zs);let c=a.range===void 0?0:a.range;switch(a.type){case`directional`:o=new Xf(s),o.target.position.set(0,0,-1),o.add(o.target);break;case`point`:o=new qf(s),o.distance=c;break;case`spot`:o=new Gf(s),o.distance=c,a.spot=a.spot||{},a.spot.innerConeAngle=a.spot.innerConeAngle===void 0?0:a.spot.innerConeAngle,a.spot.outerConeAngle=a.spot.outerConeAngle===void 0?Math.PI/4:a.spot.outerConeAngle,o.angle=a.spot.outerConeAngle,o.penumbra=1-a.spot.innerConeAngle/a.spot.outerConeAngle,o.target.position.set(0,0,-1),o.add(o.target);break;default:throw Error(`THREE.GLTFLoader: Unexpected light type: `+a.type)}return o.position.set(0,0,0),tm(o,a),a.intensity!==void 0&&(o.intensity=a.intensity),o.name=t.createUniqueName(a.name||`light_`+e),r=Promise.resolve(o),t.cache.add(n,r),r}getDependency(e,t){if(e===`light`)return this._loadLight(t)}createNodeAttachment(e){let t=this,n=this.parser,r=n.json.nodes[e],i=(r.extensions&&r.extensions[this.name]||{}).light;return i===void 0?null:this._loadLight(i).then(function(e){return n._getNodeRef(t.cache,i,e)})}},_p=class{constructor(){this.name=$.KHR_MATERIALS_UNLIT}getMaterialType(){return Fu}extendParams(e,t,n){let r=[];e.color=new Y(1,1,1),e.opacity=1;let i=t.pbrMetallicRoughness;if(i){if(Array.isArray(i.baseColorFactor)){let t=i.baseColorFactor;e.color.setRGB(t[0],t[1],t[2],zs),e.opacity=t[3]}i.baseColorTexture!==void 0&&r.push(n.assignTexture(e,`map`,i.baseColorTexture,Rs))}return Promise.all(r)}},vp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);return n===null||n.emissiveStrength!==void 0&&(t.emissiveIntensity=n.emissiveStrength),Promise.resolve()}},yp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];if(n.clearcoatFactor!==void 0&&(t.clearcoat=n.clearcoatFactor),n.clearcoatTexture!==void 0&&r.push(this.parser.assignTexture(t,`clearcoatMap`,n.clearcoatTexture)),n.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=n.clearcoatRoughnessFactor),n.clearcoatRoughnessTexture!==void 0&&r.push(this.parser.assignTexture(t,`clearcoatRoughnessMap`,n.clearcoatRoughnessTexture)),n.clearcoatNormalTexture!==void 0&&(r.push(this.parser.assignTexture(t,`clearcoatNormalMap`,n.clearcoatNormalTexture)),n.clearcoatNormalTexture.scale!==void 0)){let e=n.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new K(e,e)}return Promise.all(r)}},bp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_DISPERSION}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);return n===null||(t.dispersion=n.dispersion===void 0?0:n.dispersion),Promise.resolve()}},xp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];return n.iridescenceFactor!==void 0&&(t.iridescence=n.iridescenceFactor),n.iridescenceTexture!==void 0&&r.push(this.parser.assignTexture(t,`iridescenceMap`,n.iridescenceTexture)),n.iridescenceIor!==void 0&&(t.iridescenceIOR=n.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),n.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=n.iridescenceThicknessMinimum),n.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=n.iridescenceThicknessMaximum),n.iridescenceThicknessTexture!==void 0&&r.push(this.parser.assignTexture(t,`iridescenceThicknessMap`,n.iridescenceThicknessTexture)),Promise.all(r)}},Sp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_SHEEN}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];if(t.sheenColor=new Y(0,0,0),t.sheenRoughness=0,t.sheen=1,n.sheenColorFactor!==void 0){let e=n.sheenColorFactor;t.sheenColor.setRGB(e[0],e[1],e[2],zs)}return n.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=n.sheenRoughnessFactor),n.sheenColorTexture!==void 0&&r.push(this.parser.assignTexture(t,`sheenColorMap`,n.sheenColorTexture,Rs)),n.sheenRoughnessTexture!==void 0&&r.push(this.parser.assignTexture(t,`sheenRoughnessMap`,n.sheenRoughnessTexture)),Promise.all(r)}},Cp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];return n.transmissionFactor!==void 0&&(t.transmission=n.transmissionFactor),n.transmissionTexture!==void 0&&r.push(this.parser.assignTexture(t,`transmissionMap`,n.transmissionTexture)),Promise.all(r)}},wp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_VOLUME}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];t.thickness=n.thicknessFactor===void 0?0:n.thicknessFactor,n.thicknessTexture!==void 0&&r.push(this.parser.assignTexture(t,`thicknessMap`,n.thicknessTexture)),t.attenuationDistance=n.attenuationDistance||1/0;let i=n.attenuationColor||[1,1,1];return t.attenuationColor=new Y().setRGB(i[0],i[1],i[2],zs),Promise.all(r)}},Tp=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_IOR}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);return n===null||(t.ior=n.ior===void 0?1.5:n.ior,t.ior===0&&(t.ior=1e3)),Promise.resolve()}},Ep=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_SPECULAR}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];t.specularIntensity=n.specularFactor===void 0?1:n.specularFactor,n.specularTexture!==void 0&&r.push(this.parser.assignTexture(t,`specularIntensityMap`,n.specularTexture));let i=n.specularColorFactor||[1,1,1];return t.specularColor=new Y().setRGB(i[0],i[1],i[2],zs),n.specularColorTexture!==void 0&&r.push(this.parser.assignTexture(t,`specularColorMap`,n.specularColorTexture,Rs)),Promise.all(r)}},Dp=class{constructor(e){this.parser=e,this.name=$.EXT_MATERIALS_BUMP}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];return t.bumpScale=n.bumpFactor===void 0?1:n.bumpFactor,n.bumpTexture!==void 0&&r.push(this.parser.assignTexture(t,`bumpMap`,n.bumpTexture)),Promise.all(r)}},Op=class{constructor(e){this.parser=e,this.name=$.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){return Q(this.parser,e,this.name)===null?null:Kd}extendMaterialParams(e,t){let n=Q(this.parser,e,this.name);if(n===null)return Promise.resolve();let r=[];return n.anisotropyStrength!==void 0&&(t.anisotropy=n.anisotropyStrength),n.anisotropyRotation!==void 0&&(t.anisotropyRotation=n.anisotropyRotation),n.anisotropyTexture!==void 0&&r.push(this.parser.assignTexture(t,`anisotropyMap`,n.anisotropyTexture)),Promise.all(r)}},kp=class{constructor(e){this.parser=e,this.name=$.KHR_TEXTURE_BASISU}loadTexture(e){let t=this.parser,n=t.json,r=n.textures[e];if(!r.extensions||!r.extensions[this.name])return null;let i=r.extensions[this.name],a=t.options.ktx2Loader;if(!a){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw Error(`THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures`);return null}return t.loadTextureImage(e,i.source,a)}},Ap=class{constructor(e){this.parser=e,this.name=$.EXT_TEXTURE_WEBP}loadTexture(e){let t=this.name,n=this.parser,r=n.json,i=r.textures[e];if(!i.extensions||!i.extensions[t])return null;let a=i.extensions[t],o=r.images[a.source],s=n.textureLoader;if(o.uri){let e=n.options.manager.getHandler(o.uri);e!==null&&(s=e)}return n.loadTextureImage(e,a.source,s)}},jp=class{constructor(e){this.parser=e,this.name=$.EXT_TEXTURE_AVIF}loadTexture(e){let t=this.name,n=this.parser,r=n.json,i=r.textures[e];if(!i.extensions||!i.extensions[t])return null;let a=i.extensions[t],o=r.images[a.source],s=n.textureLoader;if(o.uri){let e=n.options.manager.getHandler(o.uri);e!==null&&(s=e)}return n.loadTextureImage(e,a.source,s)}},Mp=class{constructor(e,t){this.name=t,this.parser=e}loadBufferView(e){let t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){let e=n.extensions[this.name],r=this.parser.getDependency(`buffer`,e.buffer),i=this.parser.options.meshoptDecoder;if(!i||!i.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw Error(`THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files`);return null}return r.then(function(t){let n=e.byteOffset||0,r=e.byteLength||0,a=e.count,o=e.byteStride,s=new Uint8Array(t,n,r);return i.decodeGltfBufferAsync?i.decodeGltfBufferAsync(a,o,s,e.mode,e.filter).then(function(e){return e.buffer}):i.ready.then(function(){let t=new ArrayBuffer(a*o);return i.decodeGltfBuffer(new Uint8Array(t),a,o,s,e.mode,e.filter),t})})}return null}},Np=class{constructor(e){this.name=$.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){let t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;let r=t.meshes[n.mesh];for(let e of r.primitives)if(e.mode!==Wp.TRIANGLES&&e.mode!==Wp.TRIANGLE_STRIP&&e.mode!==Wp.TRIANGLE_FAN&&e.mode!==void 0)return null;let i=n.extensions[this.name].attributes,a=[],o={};for(let e in i)a.push(this.parser.getDependency(`accessor`,i[e]).then(t=>(o[e]=t,o[e])));return a.length<1?null:(a.push(this.parser.createNodeMesh(e)),Promise.all(a).then(e=>{let t=e.pop(),n=t.isGroup?t.children:[t],r=e[0].count,i=[];for(let e of n){let t=new J,n=new q,a=new wc,s=new q(1,1,1),c=new yd(e.geometry,e.material,r);for(let e=0;e<r;e++)o.TRANSLATION&&n.fromBufferAttribute(o.TRANSLATION,e),o.ROTATION&&a.fromBufferAttribute(o.ROTATION,e),o.SCALE&&s.fromBufferAttribute(o.SCALE,e),c.setMatrixAt(e,t.compose(n,a,s));let l=null;for(let e in o)if(e===`_COLOR_0`){let t=o[e];c.instanceColor=new dd(t.array,t.itemSize,t.normalized)}else if(e!==`TRANSLATION`&&e!==`ROTATION`&&e!==`SCALE`){if(l===null){let e=c.geometry;l=new bu,l.name=e.name;for(let t in e.attributes)l.setAttribute(t,e.attributes[t]);for(let t in e.morphAttributes)l.morphAttributes[t]=e.morphAttributes[t];e.index!==null&&l.setIndex(e.index),l.morphTargetsRelative=e.morphTargetsRelative;for(let t of e.groups)l.addGroup(t.start,t.count,t.materialIndex);e.boundingBox!==null&&(l.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(l.boundingSphere=e.boundingSphere.clone()),l.drawRange.start=e.drawRange.start,l.drawRange.count=e.drawRange.count,l.userData=Object.assign({},e.userData),c.geometry=l}let t=o[e];l.setAttribute(e,new dd(t.array,t.itemSize,t.normalized))}gl.prototype.copy.call(c,e),this.parser.assignFinalMaterial(c),i.push(c)}return t.isGroup?(t.clear(),t.add(...i),t):i[0]}))}},Pp=`glTF`,Fp=12,Ip={JSON:1313821514,BIN:5130562},Lp=class{constructor(e){this.name=$.KHR_BINARY_GLTF,this.content=null,this.body=null;let t=new DataView(e,0,Fp),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==Pp)throw Error(`THREE.GLTFLoader: Unsupported glTF-Binary header.`);if(this.header.version<2)throw Error(`THREE.GLTFLoader: Legacy binary file detected.`);let r=this.header.length-Fp,i=new DataView(e,Fp),a=0;for(;a<r;){let t=i.getUint32(a,!0);a+=4;let r=i.getUint32(a,!0);if(a+=4,r===Ip.JSON){let r=new Uint8Array(e,Fp+a,t);this.content=n.decode(r)}else if(r===Ip.BIN){let n=Fp+a;this.body=e.slice(n,n+t)}a+=t}if(this.content===null)throw Error(`THREE.GLTFLoader: JSON content not found.`)}},Rp=class{constructor(e,t){if(!t)throw Error(`THREE.GLTFLoader: No DRACOLoader instance provided.`);this.name=$.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){let n=this.json,r=this.dracoLoader,i=e.extensions[this.name].bufferView,a=e.extensions[this.name].attributes,o={},s={},c={};for(let e in a){let t=Yp[e]||e.toLowerCase();o[t]=a[e]}for(let t in e.attributes){let r=Yp[t]||t.toLowerCase();if(a[t]!==void 0){let i=n.accessors[e.attributes[t]];c[r]=Gp[i.componentType].name,s[r]=i.normalized===!0}}return t.getDependency(`bufferView`,i).then(function(e){return new Promise(function(t,n){r.decodeDracoFile(e,function(e){for(let t in e.attributes){let n=e.attributes[t],r=s[t];r!==void 0&&(n.normalized=r)}t(e)},o,c,zs,n)})})}},zp=class{constructor(){this.name=$.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){if((t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0)return e;if(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),t.rotation!==void 0){let t=Math.cos(e.rotation),n=Math.sin(e.rotation);e.matrix.set(e.repeat.x*t,e.repeat.y*n,e.offset.x,-e.repeat.x*n,e.repeat.y*t,e.offset.y,0,0,1),e.matrixAutoUpdate=!1}return e.needsUpdate=!0,e}},Bp=class{constructor(){this.name=$.KHR_MESH_QUANTIZATION}},Vp=class extends $d{constructor(e,t,n,r){super(e,t,n,r)}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,r=this.valueSize,i=e*r*3+r;for(let e=0;e!==r;e++)t[e]=n[i+e];return t}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=o*2,c=o*3,l=r-t,u=(n-t)/l,d=u*u,f=d*u,p=e*c,m=p-c,h=-2*f+3*d,g=f-d,_=1-h,v=g-d+u;for(let e=0;e!==o;e++){let t=a[m+e+o],n=a[m+e+s]*l,r=a[p+e+o],c=a[p+e]*l;i[e]=_*t+v*n+h*r+g*c}return i}},Hp=new wc,Up=class extends Vp{interpolate_(e,t,n,r){let i=super.interpolate_(e,t,n,r);return Hp.fromArray(i).normalize().toArray(i),i}},Wp={FLOAT:5126,FLOAT_MAT3:35675,FLOAT_MAT4:35676,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,LINEAR:9729,REPEAT:10497,SAMPLER_2D:35678,POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6,UNSIGNED_BYTE:5121,UNSIGNED_SHORT:5123},Gp={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Kp={9728:vs,9729:xs,9984:ys,9985:Ss,9986:bs,9987:Cs},qp={33071:gs,33648:_s,10497:hs},Jp={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Yp={POSITION:`position`,NORMAL:`normal`,TANGENT:`tangent`,TEXCOORD_0:`uv`,TEXCOORD_1:`uv1`,TEXCOORD_2:`uv2`,TEXCOORD_3:`uv3`,COLOR_0:`color`,WEIGHTS_0:`skinWeight`,JOINTS_0:`skinIndex`},Xp={scale:`scale`,translation:`position`,rotation:`quaternion`,weights:`morphTargetInfluences`},Zp={CUBICSPLINE:void 0,LINEAR:js,STEP:As},Qp={OPAQUE:`OPAQUE`,MASK:`MASK`,BLEND:`BLEND`};function $p(e){return e.DefaultMaterial===void 0&&(e.DefaultMaterial=new Gd({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:0})),e.DefaultMaterial}function em(e,t,n){for(let r in n.extensions)e[r]===void 0&&(t.userData.gltfExtensions=t.userData.gltfExtensions||{},t.userData.gltfExtensions[r]=n.extensions[r])}function tm(e,t){t.extras!==void 0&&(typeof t.extras==`object`?Object.assign(e.userData,t.extras):console.warn(`THREE.GLTFLoader: Ignoring primitive type .extras, `+t.extras))}function nm(e,t,n){let r=!1,i=!1,a=!1;for(let e=0,n=t.length;e<n;e++){let n=t[e];if(n.POSITION!==void 0&&(r=!0),n.NORMAL!==void 0&&(i=!0),n.COLOR_0!==void 0&&(a=!0),r&&i&&a)break}if(!r&&!i&&!a)return Promise.resolve(e);let o=[],s=[],c=[];for(let l=0,u=t.length;l<u;l++){let u=t[l];if(r){let t=u.POSITION===void 0?e.attributes.position:n.getDependency(`accessor`,u.POSITION);o.push(t)}if(i){let t=u.NORMAL===void 0?e.attributes.normal:n.getDependency(`accessor`,u.NORMAL);s.push(t)}if(a){let t=u.COLOR_0===void 0?e.attributes.color:n.getDependency(`accessor`,u.COLOR_0);c.push(t)}}return Promise.all([Promise.all(o),Promise.all(s),Promise.all(c)]).then(function(t){let n=t[0],o=t[1],s=t[2];return r&&(e.morphAttributes.position=n),i&&(e.morphAttributes.normal=o),a&&(e.morphAttributes.color=s),e.morphTargetsRelative=!0,e})}function rm(e,t){if(e.updateMorphTargets(),t.weights!==void 0)for(let n=0,r=t.weights.length;n<r;n++)e.morphTargetInfluences[n]=t.weights[n];if(t.extras&&Array.isArray(t.extras.targetNames)){let n=t.extras.targetNames;if(e.morphTargetInfluences.length===n.length){e.morphTargetDictionary={};for(let t=0,r=n.length;t<r;t++)e.morphTargetDictionary[n[t]]=t}else console.warn(`THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.`)}}function im(e){let t,n=e.extensions&&e.extensions[$.KHR_DRACO_MESH_COMPRESSION];if(t=n?`draco:`+n.bufferView+`:`+n.indices+`:`+am(n.attributes):e.indices+`:`+am(e.attributes)+`:`+e.mode,e.targets!==void 0)for(let n=0,r=e.targets.length;n<r;n++)t+=`:`+am(e.targets[n]);return t}function am(e){let t=``,n=Object.keys(e).sort();for(let r=0,i=n.length;r<i;r++)t+=n[r]+`:`+e[n[r]]+`;`;return t}function om(e){switch(e){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw Error(`THREE.GLTFLoader: Unsupported normalized accessor component type.`)}}function sm(e){return e.search(/\.jpe?g($|\?)/i)>0||e.search(/^data\:image\/jpeg/)===0?`image/jpeg`:e.search(/\.webp($|\?)/i)>0||e.search(/^data\:image\/webp/)===0?`image/webp`:e.search(/\.ktx2($|\?)/i)>0||e.search(/^data\:image\/ktx2/)===0?`image/ktx2`:`image/png`}var cm=new J,lm=class{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new hp,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,r=-1,i=!1,a=-1;if(typeof navigator<`u`&&navigator.userAgent!==void 0){let e=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(e)===!0;let t=e.match(/Version\/(\d+)/);r=n&&t?parseInt(t[1],10):-1,i=e.indexOf(`Firefox`)>-1,a=i?e.match(/Firefox\/([0-9]+)\./)[1]:-1}this.textureLoader=typeof createImageBitmap>`u`||n&&r<17||i&&a<98?new Af(this.options.manager):new $f(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new Ef(this.options.manager),this.fileLoader.setResponseType(`arraybuffer`),this.options.crossOrigin===`use-credentials`&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){let n=this,r=this.json,i=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(e){return e._markDefs&&e._markDefs()}),Promise.all(this._invokeAll(function(e){return e.beforeRoot&&e.beforeRoot()})).then(function(){return Promise.all([n.getDependencies(`scene`),n.getDependencies(`animation`),n.getDependencies(`camera`)])}).then(function(t){let a={scene:t[0][r.scene||0],scenes:t[0],animations:t[1],cameras:t[2],asset:r.asset,parser:n,userData:{}};return em(i,a,r),tm(a,r),Promise.all(n._invokeAll(function(e){return e.afterRoot&&e.afterRoot(a)})).then(function(){for(let e of a.scenes)e.updateMatrixWorld();e(a)})}).catch(t)}_markDefs(){let e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let n=0,r=t.length;n<r;n++){let r=t[n].joints;for(let t=0,n=r.length;t<n;t++)e[r[t]].isBone=!0}for(let t=0,r=e.length;t<r;t++){let r=e[t];r.mesh!==void 0&&(this._addNodeRef(this.meshCache,r.mesh),r.skin!==void 0&&(n[r.mesh].isSkinnedMesh=!0)),r.camera!==void 0&&this._addNodeRef(this.cameraCache,r.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;let r=n.clone(),i=(e,t)=>{let n=this.associations.get(e);n!=null&&this.associations.set(t,n);for(let[n,r]of e.children.entries())i(r,t.children[n])};return i(n,r),r.name+=`_instance_`+e.uses[t]++,r}_invokeOne(e){let t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){let r=e(t[n]);if(r)return r}return null}_invokeAll(e){let t=Object.values(this.plugins);t.unshift(this);let n=[];for(let r=0;r<t.length;r++){let i=e(t[r]);i&&n.push(i)}return n}getDependency(e,t){let n=e+`:`+t,r=this.cache.get(n);if(!r){switch(e){case`scene`:r=this.loadScene(t);break;case`node`:r=this._invokeOne(function(e){return e.loadNode&&e.loadNode(t)});break;case`mesh`:r=this._invokeOne(function(e){return e.loadMesh&&e.loadMesh(t)});break;case`accessor`:r=this.loadAccessor(t);break;case`bufferView`:r=this._invokeOne(function(e){return e.loadBufferView&&e.loadBufferView(t)});break;case`buffer`:r=this.loadBuffer(t);break;case`material`:r=this._invokeOne(function(e){return e.loadMaterial&&e.loadMaterial(t)});break;case`texture`:r=this._invokeOne(function(e){return e.loadTexture&&e.loadTexture(t)});break;case`skin`:r=this.loadSkin(t);break;case`animation`:r=this._invokeOne(function(e){return e.loadAnimation&&e.loadAnimation(t)});break;case`camera`:r=this.loadCamera(t);break;default:if(r=this._invokeOne(function(n){return n!=this&&n.getDependency&&n.getDependency(e,t)}),!r)throw Error(`Unknown type: `+e)}this.cache.add(n,r)}return r}getDependencies(e){let t=this.cache.get(e);if(!t){let n=this,r=this.json[e+(e===`mesh`?`es`:`s`)]||[];t=Promise.all(r.map(function(t,r){return n.getDependency(e,r)})),this.cache.add(e,t)}return t}loadBuffer(e){let t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!==`arraybuffer`)throw Error(`THREE.GLTFLoader: `+t.type+` buffer type is not supported.`);if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[$.KHR_BINARY_GLTF].body);let r=this.options;return new Promise(function(e,i){n.load(Zf.resolveURL(t.uri,r.path),e,void 0,function(){i(Error(`THREE.GLTFLoader: Failed to load buffer "`+t.uri+`".`))})})}loadBufferView(e){let t=this.json.bufferViews[e];return this.getDependency(`buffer`,t.buffer).then(function(e){let n=t.byteLength||0,r=t.byteOffset||0;return e.slice(r,r+n)})}loadAccessor(e){let t=this,n=this.json,r=this.json.accessors[e];if(r.bufferView===void 0&&r.sparse===void 0){let e=Jp[r.type],t=Gp[r.componentType],n=r.normalized===!0,i=new t(r.count*e);return Promise.resolve(new au(i,e,n))}let i=[];return r.bufferView===void 0?i.push(null):i.push(this.getDependency(`bufferView`,r.bufferView)),r.sparse!==void 0&&(i.push(this.getDependency(`bufferView`,r.sparse.indices.bufferView)),i.push(this.getDependency(`bufferView`,r.sparse.values.bufferView))),Promise.all(i).then(function(e){let i=e[0],a=Jp[r.type],o=Gp[r.componentType],s=o.BYTES_PER_ELEMENT,c=s*a,l=r.byteOffset||0,u=r.bufferView===void 0?void 0:n.bufferViews[r.bufferView].byteStride,d=r.normalized===!0,f,p;if(u&&u!==c){let e=Math.floor(l/u),n=`InterleavedBuffer:`+r.bufferView+`:`+r.componentType+`:`+e+`:`+r.count,c=t.cache.get(n);c||(f=new o(i,e*u,r.count*u/s),c=new xu(f,u/s),t.cache.add(n,c)),p=new Cu(c,a,l%u/s,d)}else f=i===null?new o(r.count*a):new o(i,l,r.count*a),p=new au(f,a,d);if(r.sparse!==void 0){let t=Jp.SCALAR,n=Gp[r.sparse.indices.componentType],s=r.sparse.indices.byteOffset||0,c=r.sparse.values.byteOffset||0,l=new n(e[1],s,r.sparse.count*t),u=new o(e[2],c,r.sparse.count*a);i!==null&&(p=new au(p.array.slice(),p.itemSize,p.normalized)),p.normalized=!1;for(let e=0,t=l.length;e<t;e++){let t=l[e];if(p.setX(t,u[e*a]),a>=2&&p.setY(t,u[e*a+1]),a>=3&&p.setZ(t,u[e*a+2]),a>=4&&p.setW(t,u[e*a+3]),a>=5)throw Error(`THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.`)}p.normalized=d}return p})}loadTexture(e){let t=this.json,n=this.options,r=t.textures[e].source,i=t.images[r],a=this.textureLoader;if(i.uri){let e=n.manager.getHandler(i.uri);e!==null&&(a=e)}return this.loadTextureImage(e,r,a)}loadTextureImage(e,t,n){let r=this,i=this.json,a=i.textures[e],o=i.images[t],s=(o.uri||o.bufferView)+`:`+a.sampler;if(this.textureCache[s])return this.textureCache[s];let c=this.loadImageSource(t,n).then(function(t){t.flipY=!1,t.name=a.name||o.name||``,t.name===``&&typeof o.uri==`string`&&o.uri.startsWith(`data:image/`)===!1&&(t.name=o.uri);let n=(i.samplers||{})[a.sampler]||{};return t.magFilter=Kp[n.magFilter]||1006,t.minFilter=Kp[n.minFilter]||1008,t.wrapS=qp[n.wrapS]||1e3,t.wrapT=qp[n.wrapT]||1e3,t.generateMipmaps=!t.isCompressedTexture&&t.minFilter!==1003&&t.minFilter!==1006,r.associations.set(t,{textures:e}),t}).catch(function(){return null});return this.textureCache[s]=c,c}loadImageSource(e,t){let n=this,r=this.json,i=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(e=>e.clone());let a=r.images[e],o=self.URL||self.webkitURL,s=a.uri||``,c=!1;if(a.bufferView!==void 0)s=n.getDependency(`bufferView`,a.bufferView).then(function(e){c=!0;let t=new Blob([e],{type:a.mimeType});return s=o.createObjectURL(t),s});else if(a.uri===void 0)throw Error(`THREE.GLTFLoader: Image `+e+` is missing URI and bufferView`);let l=Promise.resolve(s).then(function(e){return new Promise(function(n,r){let a=n;t.isImageBitmapLoader===!0&&(a=function(e){let t=new Hc(e);t.needsUpdate=!0,n(t)}),t.load(Zf.resolveURL(e,i.path),a,void 0,r)})}).then(function(e){return c===!0&&o.revokeObjectURL(s),tm(e,a),e.userData.mimeType=a.mimeType||sm(a.uri),e}).catch(function(e){throw console.error(`THREE.GLTFLoader: Couldn't load texture`,s),e});return this.sourceCache[e]=l,l}assignTexture(e,t,n,r){let i=this;return this.getDependency(`texture`,n.index).then(function(a){if(!a)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(a=a.clone(),a.channel=n.texCoord),i.extensions[$.KHR_TEXTURE_TRANSFORM]){let e=n.extensions===void 0?void 0:n.extensions[$.KHR_TEXTURE_TRANSFORM];if(e){let t=i.associations.get(a);a=i.extensions[$.KHR_TEXTURE_TRANSFORM].extendTexture(a,e),i.associations.set(a,t)}}return r!==void 0&&(a.colorSpace=r),e[t]=a,a})}assignFinalMaterial(e){let t=e.geometry,n=e.material,r=t.attributes.tangent===void 0,i=t.attributes.color!==void 0,a=t.attributes.normal===void 0;if(e.isPoints){let e=`PointsMaterial:`+n.uuid,t=this.cache.get(e);t||(t=new Rd,ku.prototype.copy.call(t,n),t.color.copy(n.color),t.map=n.map,t.sizeAttenuation=!1,this.cache.add(e,t)),n=t}else if(e.isLine){let e=`LineBasicMaterial:`+n.uuid,t=this.cache.get(e);t||(t=new wd,ku.prototype.copy.call(t,n),t.color.copy(n.color),t.map=n.map,this.cache.add(e,t)),n=t}if(r||i||a){let e=`ClonedMaterial:`+n.uuid+`:`;r&&(e+=`derivative-tangents:`),i&&(e+=`vertex-colors:`),a&&(e+=`flat-shading:`);let t=this.cache.get(e);t||(t=n.clone(),i&&(t.vertexColors=!0),a&&(t.flatShading=!0),r&&(t.normalScale&&(t.normalScale.y*=-1),t.clearcoatNormalScale&&(t.clearcoatNormalScale.y*=-1)),this.cache.add(e,t),this.associations.set(t,this.associations.get(n))),n=t}e.material=n}getMaterialType(){return Gd}loadMaterial(e){let t=this,n=this.json,r=this.extensions,i=n.materials[e],a,o={},s=i.extensions||{},c=[];if(s[$.KHR_MATERIALS_UNLIT]){let e=r[$.KHR_MATERIALS_UNLIT];a=e.getMaterialType(),c.push(e.extendParams(o,i,t))}else{let n=i.pbrMetallicRoughness||{};if(o.color=new Y(1,1,1),o.opacity=1,Array.isArray(n.baseColorFactor)){let e=n.baseColorFactor;o.color.setRGB(e[0],e[1],e[2],zs),o.opacity=e[3]}n.baseColorTexture!==void 0&&c.push(t.assignTexture(o,`map`,n.baseColorTexture,Rs)),o.metalness=n.metallicFactor===void 0?1:n.metallicFactor,o.roughness=n.roughnessFactor===void 0?1:n.roughnessFactor,n.metallicRoughnessTexture!==void 0&&(c.push(t.assignTexture(o,`metalnessMap`,n.metallicRoughnessTexture)),c.push(t.assignTexture(o,`roughnessMap`,n.metallicRoughnessTexture))),a=this._invokeOne(function(t){return t.getMaterialType&&t.getMaterialType(e)}),c.push(Promise.all(this._invokeAll(function(t){return t.extendMaterialParams&&t.extendMaterialParams(e,o)})))}i.doubleSided===!0&&(o.side=2);let l=i.alphaMode||Qp.OPAQUE;if(l===Qp.BLEND?(o.transparent=!0,o.depthWrite=!1):(o.transparent=!1,l===Qp.MASK&&(o.alphaTest=i.alphaCutoff===void 0?.5:i.alphaCutoff)),i.normalTexture!==void 0&&a!==Fu&&(c.push(t.assignTexture(o,`normalMap`,i.normalTexture)),o.normalScale=new K(1,1),i.normalTexture.scale!==void 0)){let e=i.normalTexture.scale;o.normalScale.set(e,e)}if(i.occlusionTexture!==void 0&&a!==Fu&&(c.push(t.assignTexture(o,`aoMap`,i.occlusionTexture)),i.occlusionTexture.strength!==void 0&&(o.aoMapIntensity=i.occlusionTexture.strength)),i.emissiveFactor!==void 0&&a!==Fu){let e=i.emissiveFactor;o.emissive=new Y().setRGB(e[0],e[1],e[2],zs)}return i.emissiveTexture!==void 0&&a!==Fu&&c.push(t.assignTexture(o,`emissiveMap`,i.emissiveTexture,Rs)),Promise.all(c).then(function(){let n=new a(o);return i.name&&(n.name=i.name),tm(n,i),t.associations.set(n,{materials:e}),i.extensions&&em(r,n,i),n})}createUniqueName(e){let t=Z.sanitizeNodeName(e||``);return t in this.nodeNamesUsed?t+`_`+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){let t=this,n=this.extensions,r=this.primitiveCache;function i(e){return n[$.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(e,t).then(function(n){return dm(n,e,t)})}let a=[];for(let n=0,o=e.length;n<o;n++){let o=e[n],s=im(o),c=r[s];if(c)a.push(c.promise);else{let e;e=o.extensions&&o.extensions[$.KHR_DRACO_MESH_COMPRESSION]?i(o):dm(new bu,o,t),o.mode===Wp.TRIANGLE_STRIP?e=e.then(e=>dp(e,1)):o.mode===Wp.TRIANGLE_FAN&&(e=e.then(e=>dp(e,2))),r[s]={primitive:o,promise:e},a.push(e)}}return Promise.all(a)}loadMesh(e){let t=this,n=this.json,r=this.extensions,i=n.meshes[e],a=i.primitives,o=[];for(let e=0,t=a.length;e<t;e++){let t=a[e].material===void 0?$p(this.cache):this.getDependency(`material`,a[e].material);o.push(t)}return o.push(t.loadGeometries(a)),Promise.all(o).then(async function(n){let o=n.slice(0,n.length-1),s=n[n.length-1],c=[];for(let n=0,l=s.length;n<l;n++){let l=s[n],u=a[n],d,f=o[n];if(u.mode===Wp.TRIANGLES||u.mode===Wp.TRIANGLE_STRIP||u.mode===Wp.TRIANGLE_FAN||u.mode===void 0){let e=i.isSkinnedMesh===!0,t=l.hasAttribute(`skinIndex`)&&l.hasAttribute(`skinWeight`);e&&t===!1&&console.warn(`THREE.GLTFLoader: Missing skinIndex or skinWeight attributes. Skinning disabled.`),d=e&&t?new ad(l,f):new qu(l,f),d.isSkinnedMesh===!0&&d.normalizeSkinWeights()}else if(u.mode===Wp.LINES)d=new Id(l,f);else if(u.mode===Wp.LINE_STRIP)d=new Md(l,f);else if(u.mode===Wp.LINE_LOOP)d=new Ld(l,f);else if(u.mode===Wp.POINTS)d=new Ud(l,f);else throw Error(`THREE.GLTFLoader: Primitive mode unsupported: `+u.mode);Object.keys(d.geometry.morphAttributes).length>0&&rm(d,i),d.name=t.createUniqueName(i.name||`mesh_`+e),tm(d,i),u.extensions&&em(r,d,u),t.assignFinalMaterial(d),c.push(d)}for(let n=0,r=c.length;n<r;n++)t.associations.set(c[n],{meshes:e,primitives:n});if(c.length===1)return i.extensions&&em(r,c[0],i),c[0];let l=new _l;i.extensions&&em(r,l,i),t.associations.set(l,{meshes:e});for(let e=0,t=c.length;e<t;e++)l.add(c[e]);return l})}loadCamera(e){let t,n=this.json.cameras[e],r=n[n.type];if(!r)console.warn(`THREE.GLTFLoader: Missing camera parameters.`);else return n.type===`perspective`?t=new Uf(Cc.radToDeg(r.yfov),r.aspectRatio||1,r.znear||1,r.zfar||2e6):n.type===`orthographic`&&(t=new Jf(-r.xmag,r.xmag,r.ymag,-r.ymag,r.znear,r.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),tm(t,n),Promise.resolve(t)}loadSkin(e){let t=this.json.skins[e],n=[];for(let e=0,r=t.joints.length;e<r;e++)n.push(this._loadNodeShallow(t.joints[e]));return t.inverseBindMatrices===void 0?n.push(null):n.push(this.getDependency(`accessor`,t.inverseBindMatrices)),Promise.all(n).then(function(e){let n=e.pop(),r=e,i=[],a=[];for(let e=0,o=r.length;e<o;e++){let o=r[e];if(o){i.push(o);let t=new J;n!==null&&t.fromArray(n.array,e*16),a.push(t)}else console.warn(`THREE.GLTFLoader: Joint "%s" could not be found.`,t.joints[e])}return new ud(i,a)})}loadAnimation(e){let t=this.json,n=this,r=t.animations[e],i=r.name?r.name:`animation_`+e,a=[],o=[],s=[],c=[],l=[];for(let e=0,t=r.channels.length;e<t;e++){let t=r.channels[e],n=r.samplers[t.sampler],i=t.target,u=i.node,d=r.parameters===void 0?n.input:r.parameters[n.input],f=r.parameters===void 0?n.output:r.parameters[n.output];i.node!==void 0&&(a.push(this.getDependency(`node`,u)),o.push(this.getDependency(`accessor`,d)),s.push(this.getDependency(`accessor`,f)),c.push(n),l.push(i))}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(s),Promise.all(c),Promise.all(l)]).then(function(e){let t=e[0],a=e[1],o=e[2],s=e[3],c=e[4],l=[];for(let e=0,r=t.length;e<r;e++){let r=t[e],i=a[e],u=o[e],d=s[e],f=c[e];if(r===void 0)continue;r.updateMatrix&&r.updateMatrix();let p=n._createAnimationTracks(r,i,u,d,f);if(p)for(let e=0;e<p.length;e++)l.push(p[e])}let u=new _f(i,void 0,l);return tm(u,r),u})}createNodeMesh(e){let t=this.json,n=this,r=t.nodes[e];return r.mesh===void 0?null:n.getDependency(`mesh`,r.mesh).then(function(e){let t=n._getNodeRef(n.meshCache,r.mesh,e);return r.weights!==void 0&&t.traverse(function(e){if(e.isMesh)for(let t=0,n=r.weights.length;t<n;t++)e.morphTargetInfluences[t]=r.weights[t]}),t})}loadNode(e){let t=this.json,n=this,r=t.nodes[e],i=n._loadNodeShallow(e),a=[],o=r.children||[];for(let e=0,t=o.length;e<t;e++)a.push(n.getDependency(`node`,o[e]));let s=r.skin===void 0?Promise.resolve(null):n.getDependency(`skin`,r.skin);return Promise.all([i,Promise.all(a),s]).then(function(e){let t=e[0],n=e[1],r=e[2];r!==null&&t.traverse(function(e){e.isSkinnedMesh&&e.bind(r,cm)});for(let e=0,r=n.length;e<r;e++)t.add(n[e]);if(t.userData.pivot!==void 0&&n.length>0){let e=t.userData.pivot,r=n[0];t.pivot=new q().fromArray(e),t.position.x-=e[0],t.position.y-=e[1],t.position.z-=e[2],r.position.set(0,0,0),delete t.userData.pivot}return t})}_loadNodeShallow(e){let t=this.json,n=this.extensions,r=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];let i=t.nodes[e],a=i.name?r.createUniqueName(i.name):``,o=[],s=r._invokeOne(function(t){return t.createNodeMesh&&t.createNodeMesh(e)});return s&&o.push(s),i.camera!==void 0&&o.push(r.getDependency(`camera`,i.camera).then(function(e){return r._getNodeRef(r.cameraCache,i.camera,e)})),r._invokeAll(function(t){return t.createNodeAttachment&&t.createNodeAttachment(e)}).forEach(function(e){o.push(e)}),this.nodeCache[e]=Promise.all(o).then(function(t){let o;if(o=i.isBone===!0?new od:t.length>1?new _l:t.length===1?t[0]:new gl,o!==t[0])for(let e=0,n=t.length;e<n;e++)o.add(t[e]);if(i.name&&(o.userData.name=i.name,o.name=a),tm(o,i),i.extensions&&em(n,o,i),i.matrix!==void 0){let e=new J;e.fromArray(i.matrix),o.applyMatrix4(e)}else i.translation!==void 0&&o.position.fromArray(i.translation),i.rotation!==void 0&&o.quaternion.fromArray(i.rotation),i.scale!==void 0&&o.scale.fromArray(i.scale);if(!r.associations.has(o))r.associations.set(o,{});else if(i.mesh!==void 0&&r.meshCache.refs[i.mesh]>1){let e=r.associations.get(o);r.associations.set(o,{...e})}return r.associations.get(o).nodes=e,o}),this.nodeCache[e]}loadScene(e){let t=this.extensions,n=this.json.scenes[e],r=this,i=new _l;n.name&&(i.name=r.createUniqueName(n.name)),tm(i,n),n.extensions&&em(t,i,n);let a=n.nodes||[],o=[];for(let e=0,t=a.length;e<t;e++)o.push(r.getDependency(`node`,a[e]));return Promise.all(o).then(function(e){for(let t=0,n=e.length;t<n;t++){let n=e[t];n.parent===null?i.add(n):i.add(fp(n))}return r.associations=(e=>{let t=new Map;for(let[e,n]of r.associations)(e instanceof ku||e instanceof Hc)&&t.set(e,n);return e.traverse(e=>{let n=r.associations.get(e);n!=null&&t.set(e,n)}),t})(i),i})}_createAnimationTracks(e,t,n,r,i){let a=[],o=e.name?e.name:e.uuid,s=[];function c(e){e.morphTargetInfluences&&s.push(e.name?e.name:e.uuid)}Xp[i.path]===Xp.weights?(c(e),e.isGroup&&e.children.forEach(c)):s.push(o);let l;switch(Xp[i.path]){case Xp.weights:l=ff;break;case Xp.rotation:l=mf;break;case Xp.translation:case Xp.scale:l=gf;break;default:switch(n.itemSize){case 1:l=ff;break;default:l=gf}}let u=r.interpolation===void 0?js:Zp[r.interpolation],d=this._getArrayFromAccessor(n);for(let e=0,n=s.length;e<n;e++){let n=new l(s[e]+`.`+Xp[i.path],t.array,d,u);r.interpolation===`CUBICSPLINE`&&this._createCubicSplineTrackInterpolant(n),a.push(n)}return a}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){let e=om(t.constructor),n=new Float32Array(t.length);for(let r=0,i=t.length;r<i;r++)n[r]=t[r]*e;t=n}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(e){return new(this instanceof mf?Up:Vp)(this.times,this.values,this.getValueSize()/3,e)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}};function um(e,t,n){let r=t.attributes,i=new Ll;if(r.POSITION!==void 0){let e=n.json.accessors[r.POSITION],t=e.min,a=e.max;if(t!==void 0&&a!==void 0){if(i.set(new q(t[0],t[1],t[2]),new q(a[0],a[1],a[2])),e.normalized){let t=om(Gp[e.componentType]);i.min.multiplyScalar(t),i.max.multiplyScalar(t)}}else{console.warn(`THREE.GLTFLoader: Missing min/max properties for accessor POSITION.`);return}}else return;let a=t.targets;if(a!==void 0){let e=new q,t=new q;for(let r=0,i=a.length;r<i;r++){let i=a[r];if(i.POSITION!==void 0){let r=n.json.accessors[i.POSITION],a=r.min,o=r.max;if(a!==void 0&&o!==void 0){if(t.setX(Math.max(Math.abs(a[0]),Math.abs(o[0]))),t.setY(Math.max(Math.abs(a[1]),Math.abs(o[1]))),t.setZ(Math.max(Math.abs(a[2]),Math.abs(o[2]))),r.normalized){let e=om(Gp[r.componentType]);t.multiplyScalar(e)}e.max(t)}else console.warn(`THREE.GLTFLoader: Missing min/max properties for accessor POSITION.`)}}i.expandByVector(e)}e.boundingBox=i;let o=new fu;i.getCenter(o.center),o.radius=i.min.distanceTo(i.max)/2,e.boundingSphere=o}function dm(e,t,n){let r=t.attributes,i=[];function a(t,r){return n.getDependency(`accessor`,t).then(function(t){e.setAttribute(r,t)})}for(let t in r){let n=Yp[t]||t.toLowerCase();n in e.attributes||i.push(a(r[t],n))}if(t.indices!==void 0&&!e.index){let r=n.getDependency(`accessor`,t.indices).then(function(t){e.setIndex(t)});i.push(r)}return Mc.workingColorSpace!==`srgb-linear`&&`COLOR_0`in r&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${Mc.workingColorSpace}" not supported.`),tm(e,t),um(e,t,n),Promise.all(i).then(function(){return t.targets===void 0?e:nm(e,t.targets,n)})}var fm=/^[og]\s*(.+)?/,pm=/^mtllib /,mm=/^usemtl /,hm=/^usemap /,gm=/\s+/,_m=new q,vm=new q,ym=new q,bm=new q,xm=new q,Sm=new Y;function Cm(){let e={objects:[],object:{},vertices:[],normals:[],colors:[],uvs:[],materials:{},materialLibraries:[],startObject:function(e,t){if(this.object&&this.object.fromDeclaration===!1){this.object.name=e,this.object.fromDeclaration=t!==!1;return}let n=this.object&&typeof this.object.currentMaterial==`function`?this.object.currentMaterial():void 0;if(this.object&&typeof this.object._finalize==`function`&&this.object._finalize(!0),this.object={name:e||``,fromDeclaration:t!==!1,geometry:{vertices:[],normals:[],colors:[],uvs:[],hasUVIndices:!1},materials:[],smooth:!0,startMaterial:function(e,t){let n=this._finalize(!1);n&&(n.inherited||n.groupCount<=0)&&this.materials.splice(n.index,1);let r={index:this.materials.length,name:e||``,mtllib:Array.isArray(t)&&t.length>0?t[t.length-1]:``,smooth:n===void 0?this.smooth:n.smooth,groupStart:n===void 0?0:n.groupEnd,groupEnd:-1,groupCount:-1,inherited:!1,clone:function(e){let t={index:typeof e==`number`?e:this.index,name:this.name,mtllib:this.mtllib,smooth:this.smooth,groupStart:0,groupEnd:-1,groupCount:-1,inherited:!1};return t.clone=this.clone.bind(t),t}};return this.materials.push(r),r},currentMaterial:function(){if(this.materials.length>0)return this.materials[this.materials.length-1]},_finalize:function(e){let t=this.currentMaterial();if(t&&t.groupEnd===-1&&(t.groupEnd=this.geometry.vertices.length/3,t.groupCount=t.groupEnd-t.groupStart,t.inherited=!1),e&&this.materials.length>1)for(let e=this.materials.length-1;e>=0;e--)this.materials[e].groupCount<=0&&this.materials.splice(e,1);return e&&this.materials.length===0&&this.materials.push({name:``,smooth:this.smooth}),t}},n&&n.name&&typeof n.clone==`function`){let e=n.clone(0);e.inherited=!0,this.object.materials.push(e)}this.objects.push(this.object)},finalize:function(){this.object&&typeof this.object._finalize==`function`&&this.object._finalize(!0)},parseVertexIndex:function(e,t){let n=parseInt(e,10);return(n>=0?n-1:n+t/3)*3},parseNormalIndex:function(e,t){let n=parseInt(e,10);return(n>=0?n-1:n+t/3)*3},parseUVIndex:function(e,t){let n=parseInt(e,10);return(n>=0?n-1:n+t/2)*2},addVertex:function(e,t,n){let r=this.vertices,i=this.object.geometry.vertices;i.push(r[e+0],r[e+1],r[e+2]),i.push(r[t+0],r[t+1],r[t+2]),i.push(r[n+0],r[n+1],r[n+2])},addVertexPoint:function(e){let t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addVertexLine:function(e){let t=this.vertices;this.object.geometry.vertices.push(t[e+0],t[e+1],t[e+2])},addNormal:function(e,t,n){let r=this.normals,i=this.object.geometry.normals;i.push(r[e+0],r[e+1],r[e+2]),i.push(r[t+0],r[t+1],r[t+2]),i.push(r[n+0],r[n+1],r[n+2])},addFaceNormal:function(e,t,n){let r=this.vertices,i=this.object.geometry.normals;_m.fromArray(r,e),vm.fromArray(r,t),ym.fromArray(r,n),xm.subVectors(ym,vm),bm.subVectors(_m,vm),xm.cross(bm),xm.normalize(),i.push(xm.x,xm.y,xm.z),i.push(xm.x,xm.y,xm.z),i.push(xm.x,xm.y,xm.z)},addColor:function(e,t,n){let r=this.colors,i=this.object.geometry.colors;r[e]!==void 0&&i.push(r[e+0],r[e+1],r[e+2]),r[t]!==void 0&&i.push(r[t+0],r[t+1],r[t+2]),r[n]!==void 0&&i.push(r[n+0],r[n+1],r[n+2])},addUV:function(e,t,n){let r=this.uvs,i=this.object.geometry.uvs;i.push(r[e+0],r[e+1]),i.push(r[t+0],r[t+1]),i.push(r[n+0],r[n+1])},addDefaultUV:function(){let e=this.object.geometry.uvs;e.push(0,0),e.push(0,0),e.push(0,0)},addUVLine:function(e){let t=this.uvs;this.object.geometry.uvs.push(t[e+0],t[e+1])},addFace:function(e,t,n,r,i,a,o,s,c){let l=this.vertices.length,u=this.parseVertexIndex(e,l),d=this.parseVertexIndex(t,l),f=this.parseVertexIndex(n,l);if(this.addVertex(u,d,f),this.addColor(u,d,f),o!==void 0&&o!==``){let e=this.normals.length;u=this.parseNormalIndex(o,e),d=this.parseNormalIndex(s,e),f=this.parseNormalIndex(c,e),this.addNormal(u,d,f)}else this.addFaceNormal(u,d,f);if(r!==void 0&&r!==``){let e=this.uvs.length;u=this.parseUVIndex(r,e),d=this.parseUVIndex(i,e),f=this.parseUVIndex(a,e),this.addUV(u,d,f),this.object.geometry.hasUVIndices=!0}else this.addDefaultUV()},addPointGeometry:function(e){this.object.geometry.type=`Points`;let t=this.vertices.length;for(let n=0,r=e.length;n<r;n++){let r=this.parseVertexIndex(e[n],t);this.addVertexPoint(r),this.addColor(r)}},addLineGeometry:function(e,t){this.object.geometry.type=`Line`;let n=this.vertices.length,r=this.uvs.length;for(let t=0,r=e.length;t<r;t++)this.addVertexLine(this.parseVertexIndex(e[t],n));for(let e=0,n=t.length;e<n;e++)this.addUVLine(this.parseUVIndex(t[e],r))}};return e.startObject(``,!1),e}var wm=class extends Cf{constructor(e){super(e),this.materials=null}load(e,t,n,r){let i=this,a=new Ef(this.manager);a.setPath(this.path),a.setRequestHeader(this.requestHeader),a.setWithCredentials(this.withCredentials),a.load(e,function(n){try{t(i.parse(n))}catch(t){r?r(t):console.error(t),i.manager.itemError(e)}},n,r)}setMaterials(e){return this.materials=e,this}parse(e){let t=new Cm;e.indexOf(`\r
`)!==-1&&(e=e.replace(/\r\n/g,`
`)),e.indexOf(`\\
`)!==-1&&(e=e.replace(/\\\n/g,``));let n=e.split(`
`),r=[];for(let e=0,i=n.length;e<i;e++){let i=n[e].trimStart();if(i.length===0)continue;let a=i.charAt(0);if(a!==`#`){if(a===`v`){let e=i.split(gm);switch(e[0]){case`v`:t.vertices.push(parseFloat(e[1]),parseFloat(e[2]),parseFloat(e[3])),e.length>=7?(Sm.setRGB(parseFloat(e[4]),parseFloat(e[5]),parseFloat(e[6]),Rs),t.colors.push(Sm.r,Sm.g,Sm.b)):t.colors.push(void 0,void 0,void 0);break;case`vn`:t.normals.push(parseFloat(e[1]),parseFloat(e[2]),parseFloat(e[3]));break;case`vt`:t.uvs.push(parseFloat(e[1]),parseFloat(e[2]))}}else if(a===`f`){let e=i.slice(1).trim().split(gm),n=[];for(let t=0,r=e.length;t<r;t++){let r=e[t];if(r.length>0){let e=r.split(`/`);n.push(e)}}let r=n[0];for(let e=1,i=n.length-1;e<i;e++){let i=n[e],a=n[e+1];t.addFace(r[0],i[0],a[0],r[1],i[1],a[1],r[2],i[2],a[2])}}else if(a===`l`){let e=i.substring(1).trim().split(` `),n=[],r=[];if(i.indexOf(`/`)===-1)n=e;else for(let t=0,i=e.length;t<i;t++){let i=e[t].split(`/`);i[0]!==``&&n.push(i[0]),i[1]!==``&&r.push(i[1])}t.addLineGeometry(n,r)}else if(a===`p`){let e=i.slice(1).trim().split(` `);t.addPointGeometry(e)}else if((r=fm.exec(i))!==null){let e=(` `+r[0].slice(1).trim()).slice(1);t.startObject(e)}else if(mm.test(i))t.object.startMaterial(i.substring(7).trim(),t.materialLibraries);else if(pm.test(i))t.materialLibraries.push(i.substring(7).trim());else if(hm.test(i))console.warn(`THREE.OBJLoader: Rendering identifier "usemap" not supported. Textures must be defined in MTL files.`);else if(a===`s`){if(r=i.split(` `),r.length>1){let e=r[1].trim().toLowerCase();t.object.smooth=e!==`0`&&e!==`off`}else t.object.smooth=!0;let e=t.object.currentMaterial();e&&(e.smooth=t.object.smooth)}else{if(i===`\0`)continue;console.warn(`THREE.OBJLoader: Unexpected line: "`+i+`"`)}}}t.finalize();let i=new _l;if(i.materialLibraries=[].concat(t.materialLibraries),t.objects.length!==1||t.objects[0].geometry.vertices.length!==0)for(let e=0,n=t.objects.length;e<n;e++){let n=t.objects[e],r=n.geometry,a=n.materials,o=r.type===`Line`,s=r.type===`Points`,c=!1;if(r.vertices.length===0)continue;let l=new bu;l.setAttribute(`position`,new cu(r.vertices,3)),r.normals.length>0&&l.setAttribute(`normal`,new cu(r.normals,3)),r.colors.length>0&&(c=!0,l.setAttribute(`color`,new cu(r.colors,3))),r.hasUVIndices===!0&&l.setAttribute(`uv`,new cu(r.uvs,2));let u=[];for(let e=0,n=a.length;e<n;e++){let n=a[e],r=n.name+`_`+n.smooth+`_`+c,i=t.materials[r];if(this.materials!==null){if(i=this.materials.create(n.name),o&&i&&!(i instanceof wd)){let e=new wd;ku.prototype.copy.call(e,i),e.color.copy(i.color),i=e}else if(s&&i&&!(i instanceof Rd)){let e=new Rd({size:10,sizeAttenuation:!1});ku.prototype.copy.call(e,i),e.color.copy(i.color),e.map=i.map,i=e}}i===void 0&&(i=o?new wd:s?new Rd({size:1,sizeAttenuation:!1}):new qd,i.name=n.name,i.flatShading=!n.smooth,i.vertexColors=c,t.materials[r]=i),u.push(i)}let d;if(u.length>1){for(let e=0,t=a.length;e<t;e++){let t=a[e];l.addGroup(t.groupStart,t.groupCount,e)}d=o?new Id(l,u):s?new Ud(l,u):new qu(l,u)}else d=o?new Id(l,u[0]):s?new Ud(l,u[0]):new qu(l,u[0]);d.name=n.name,i.add(d)}else if(t.vertices.length>0){let e=new Rd({size:1,sizeAttenuation:!1}),n=new bu;n.setAttribute(`position`,new cu(t.vertices,3)),t.colors.length>0&&t.colors[0]!==void 0&&(n.setAttribute(`color`,new cu(t.colors,3)),e.vertexColors=!0);let r=new Ud(n,e);i.add(r)}return i}};function Tm(e,t){if(/^[a-z]+:\/\//i.test(e))return new URL(t,e).href;if(/^[a-z]+:\/\//i.test(t))return t;let n=new URL(e,`http://scene.local/`),r=new URL(t,n);return e.startsWith(`/`)||t.startsWith(`/`)?r.pathname:r.pathname.slice(1)}async function Em(e){let t=await fetch(e);if(!t.ok)throw Error(`HTTP ${t.status} for ${e}`);return t.arrayBuffer()}async function Dm(e,t){let n=new URL(t,`http://scene.local/`).pathname.split(`.`).at(-1)?.toLowerCase();if(n===`obj`)return{root:new wm().parse(new TextDecoder().decode(e)),flipV:!1};if(n===`glb`){let n=new mp,r=new Fu;return n.register(()=>({name:`EngineGeometryOnly`,loadMaterial:()=>Promise.resolve(r)})),{root:(await n.parseAsync(e,t.slice(0,t.lastIndexOf(`/`)+1))).scene,flipV:!0}}throw Error(`Unsupported geometry format: ${t} (expected .glb or .obj)`)}function Om(e,t,n,r){e.updateMatrixWorld(!0);let i=e;if(t){let n=[];if(e.traverse(e=>{e.name===t&&n.push(e)}),n.length!==1)throw Error(`Expected one object named '${t}', found ${n.length}`);i=n[0]}let a=[];if(i.traverse(e=>{if(e instanceof qu){if(e instanceof ad||e.geometry.morphAttributes.position?.length)throw Error(`Animated geometry is not supported: ${e.name}`);if(e instanceof yd)throw Error(`glTF GPU instancing is not supported: ${e.name}`);a.push(e)}}),a.length===0)throw Error(`No triangle mesh found${t?` in '${t}'`:``}`);let o=[],s=[],c=[],l=[],u=[],d=a.every(e=>e.geometry.hasAttribute(`uv`));!d&&a.some(e=>e.geometry.hasAttribute(`uv`))&&n({level:`warning`,message:`Mixed UV availability in '${t??e.name}'; select individual objects to preserve UVs`});let f=new q;for(let e of a){let t=e.geometry.hasAttribute(`normal`)?e.geometry:e.geometry.clone();t.hasAttribute(`normal`)||t.computeVertexNormals();let n=t.getAttribute(`position`),i=t.getAttribute(`normal`),a=t.getAttribute(`uv`);if(!n||n.itemSize!==3)throw Error(`Missing 3D positions: ${e.name}`);if(i.count!==n.count||i.itemSize!==3)throw Error(`Invalid normals: ${e.name}`);if(d&&(a.count!==n.count||a.itemSize!==2))throw Error(`Invalid UVs: ${e.name}`);let p=o.length/3,m=new Dc().getNormalMatrix(e.matrixWorld);for(let t=0;t<n.count;t++){if(f.fromBufferAttribute(n,t).applyMatrix4(e.matrixWorld),![f.x,f.y,f.z].every(Number.isFinite))throw Error(`Invalid position in ${e.name}`);if(o.push(f.x,f.y,f.z),f.fromBufferAttribute(i,t).applyNormalMatrix(m),![f.x,f.y,f.z].every(Number.isFinite))throw Error(`Invalid normal in ${e.name}`);if(s.push(f.x,f.y,f.z),d){let n=a.getX(t),i=a.getY(t);if(!Number.isFinite(n)||!Number.isFinite(i))throw Error(`Invalid UV in ${e.name}`);c.push(n,r?1-i:i)}}let h=t.index?.count??n.count;if(h===0||h%3!=0)throw Error(`Invalid triangle count: ${e.name}`);let g=e.matrixWorld.determinant()<0;for(let r=0;r<h;r+=3){let i=[0,g?2:1,g?1:2].map(e=>t.index?.getX(r+e)??r+e);if(i.some(e=>!Number.isInteger(e)||e<0||e>=n.count))throw Error(`Out-of-range triangle index: ${e.name}`);l.push(3),u.push(...i.map(e=>e+p))}}return{points:o,faceVertexCounts:l,faceVertexIndices:u,normals:{name:`normals`,interpolation:`vertex`,elementSize:3,values:s},...d?{primvars:[{name:`st`,interpolation:`vertex`,elementSize:2,values:c}]}:{}}}async function km(e,t,n,r=Em){let i=new Map,a=new Map;for(let[t,o]of e.prims){let s=o.attributes.get(`engine:geometry:file`);if(s)try{if(o.typeName!==`Mesh`)throw Error(`engine:geometry:file requires a Mesh prim`);if(typeof s.value!=`string`||!s.value)throw Error(`Missing geometry asset path`);let c=o.attributes.get(`engine:geometry:object`)?.value;if(c!==void 0&&(typeof c!=`string`||!c))throw Error(`Invalid geometry object name`);let l=Tm(s.sourceLayer??e.entry,s.value),u=i.get(l);u||(u=r(l).then(e=>Dm(e,l)),i.set(l,u));let{root:d,flipV:f}=await u;a.set(t,Om(d,c,n,f))}catch(e){let r=`Failed to load geometry for ${t}: ${String(e)}`;throw n({level:`error`,message:r}),Error(r,{cause:e})}}return{meshFor:e=>a.get(e)??t.meshFor(e)}}var Am=class extends Error{name=`AssetResolutionError`},jm=/<UDIM>/gi,Mm=/^(https?:|blob:|data:)/i,Nm=/^[a-zA-Z]:[\\/]/;function Pm(e){return Mm.test(e)}function Fm(e){return Nm.test(e)||e.startsWith(`file:`)||e.startsWith(`/`)}function Im(e){let t=[];for(let n of e.split(`/`))if(n!==``&&n!==`.`){if(n===`..`){if(t.length===0)return null;t.pop()}else t.push(n)}return t.join(`/`)}function Lm(e){let t=e.lastIndexOf(`/`);return t<0?``:e.slice(0,t)}function Rm(e){return e.replace(/\\/g,`/`)}var zm=class e{rootUrl;fileMap;diag;constructor(e={}){this.rootUrl=e.rootUrl?e.rootUrl.replace(/\/+$/,``):void 0,this.fileMap=e.fileMap,this.diag=e.onDiagnostic??Cn}static hasUdim(e){return jm.lastIndex=0,jm.test(e)}static expandUdim(e,t){return e.replace(jm,String(t))}resolve(e,t=``){let n=e.trim();if(n===``)throw this.fail(`Empty asset reference.`,e);if(Pm(n))return{key:n,url:n};if(Fm(n)){let t=this.lookupFileMap(n);if(t)return t;throw this.fail(`Local/absolute path cannot be opened by the browser and is not in the file map: ${n}`,e)}let r=Lm(Rm(t)),i=Im(r?`${r}/${Rm(n)}`:Rm(n));if(i===null)throw this.fail(`Reference escapes the asset root: ${n} (base ${t})`,e);let a=this.fileMap?.get(i);if(a)return{key:i,url:a};if(this.rootUrl)return{key:i,url:`${this.rootUrl}/${i}`};throw this.fail(`No asset root configured to resolve: ${i}`,e)}resolveUdimTile(t,n,r=``){return this.resolve(e.expandUdim(t,n),r)}lookupFileMap(e){if(!this.fileMap)return;let t=this.fileMap.get(e);if(t)return{key:e,url:t};let n=Rm(e).replace(Nm,``).replace(/^file:\/*/i,``).replace(/^\/+/,``),r=this.fileMap.get(n);return r?{key:n,url:r}:void 0}fail(e,t){return this.diag({level:`error`,message:e,detail:{ref:t}}),new Am(e)}},Bm=class extends Error{name=`UsdImportError`},Vm=new Set([`{`,`}`,`(`,`)`,`[`,`]`,`=`]),Hm=new Set([` `,`	`,`\r`,`
`,`{`,`}`,`(`,`)`,`[`,`]`,`=`,`,`,`"`,`@`,`<`,`#`]);function Um(e){let t=[],n=0,r=e.length;for(;n<r;){let i=e[n];if(i===` `||i===`	`||i===`\r`||i===`
`||i===`,`){n+=1;continue}if(i===`#`){for(;n<r&&e[n]!==`
`;)n+=1;continue}if(Vm.has(i)){t.push({kind:`punct`,value:i}),n+=1;continue}if(i===`"`){if(e[n+1]===`"`&&e[n+2]===`"`){n+=3;let i=n;for(;n<r&&(e[n]!==`"`||e[n+1]!==`"`||e[n+2]!==`"`);)n+=1;t.push({kind:`string`,value:e.slice(i,n)}),n+=3}else{n+=1;let i=``;for(;n<r&&e[n]!==`"`;){if(e[n]===`\\`&&n+1<r){n++;let t=e[n];i+=t===`n`?`
`:t===`t`?`	`:t}else i+=e[n];n++}t.push({kind:`string`,value:i}),n+=1}continue}if(i===`@`){n+=1;let i=n;for(;n<r&&e[n]!==`@`;)n+=1;t.push({kind:`asset`,value:e.slice(i,n)}),n+=1;continue}if(i===`<`){n+=1;let i=n;for(;n<r&&e[n]!==`>`;)n+=1;t.push({kind:`path`,value:e.slice(i,n)}),n+=1;continue}let a=n;for(;n<r&&!Hm.has(e[n]);)n+=1;e[n]===`[`&&e[n+1]===`]`&&(n+=2),t.push({kind:`word`,value:e.slice(a,n)})}return t}var Wm=class{tokens;uri;pos=0;constructor(e,t){this.tokens=e,this.uri=t}peek(){return this.tokens[this.pos]}next(){let e=this.tokens[this.pos];if(!e)throw new Bm(`Unexpected end of USDA in ${this.uri}.`);return this.pos+=1,e}expectPunct(e){let t=this.next();if(t.kind!==`punct`||t.value!==e)throw new Bm(`Expected '${e}' in ${this.uri}, got '${t.value}'.`)}parseLayer(){let e={subLayers:[]},t=this.peek();t&&t.kind===`punct`&&t.value===`(`&&this.parseLayerMetadata(e);let n=[];for(;this.peek();)n.push(this.parsePrim());return{uri:this.uri,metadata:e,prims:n}}parseLayerMetadata(e){for(this.expectPunct(`(`);;){let t=this.peek();if(!t)throw new Bm(`Unterminated layer metadata in ${this.uri}.`);if(t.kind===`punct`&&t.value===`)`){this.next();break}if(t.kind===`string`){this.next();continue}let n=this.readMetadataKey();this.expectPunct(`=`);let r=this.parseValue();if(n===`defaultPrim`)e.defaultPrim=qm(r);else if(n===`upAxis`)e.upAxis=qm(r);else if(n===`metersPerUnit`){let t=Jm(r);t!==void 0&&(e.metersPerUnit=t)}else if(n===`subLayers`)for(let t of Ym(r))t.assetPath!==void 0&&e.subLayers.push(t.assetPath)}}readMetadataKey(){let e=this.next();for(;e.kind===`word`&&Km.has(e.value);)e=this.next();return e.value}parsePrim(){let e=this.next();if(e.kind!==`word`||!Gm.has(e.value))throw new Bm(`Expected prim specifier in ${this.uri}, got '${e.value}'.`);let t=e.value,n,r,i=this.next();if(i.kind===`word`){n=i.value;let e=this.next();if(e.kind!==`string`)throw new Bm(`Expected prim name string in ${this.uri}, got '${e.value}'.`);r=e.value}else if(i.kind===`string`)r=i.value;else throw new Bm(`Expected prim name in ${this.uri}, got '${i.value}'.`);let a={specifier:t,...n===void 0?{}:{typeName:n},name:r,metadata:new Map,references:[],payloads:[],inherits:[],apiSchemas:[],attributes:new Map,relationships:new Map,children:[],xformValues:new Map},o=this.peek();return o&&o.kind===`punct`&&o.value===`(`&&this.parsePrimMetadata(a),this.expectPunct(`{`),this.parsePrimBody(a),a}parsePrimMetadata(e){for(this.expectPunct(`(`);;){let t=this.peek();if(!t)throw new Bm(`Unterminated prim metadata in ${this.uri}.`);if(t.kind===`punct`&&t.value===`)`){this.next();break}if(t.kind===`string`){this.next();continue}let n=this.readMetadataKey();this.expectPunct(`=`);let r=this.parseValue();if(n===`references`)e.references.push(...Ym(r));else if(n===`payload`)e.payloads.push(...Ym(r));else if(n===`inherits`)for(let t of Ym(r))t.primPath!==void 0&&e.inherits.push(t.primPath);else n===`apiSchemas`?e.apiSchemas.push(...Xm(r)):n===`kind`?e.kind=qm(r):e.metadata.set(n,r)}}parsePrimBody(e){for(;;){let t=this.peek();if(!t)throw new Bm(`Unterminated prim body in ${this.uri}.`);if(t.kind===`punct`&&t.value===`}`){this.next();break}t.kind===`word`&&Gm.has(t.value)?e.children.push(this.parsePrim()):this.parseMember(e)}}parseMember(e){let t=[];for(;;){let n=this.peek();if(!n)throw new Bm(`Unterminated member in ${this.uri}.`);if(n.kind===`word`){if(t.push(n.value),this.next(),n.value===`rel`){this.parseRelationship(e);return}if(t.filter(e=>![`custom`,`uniform`,`varying`,`config`].includes(e)).length>=2)break;let r=this.peek();if(r&&r.kind===`punct`&&(r.value===`=`||r.value===`(`))break}else break}this.parseAttribute(e,t)}parseRelationship(e){let t=this.next().value,n,r,i=this.peek();if(i&&i.kind===`punct`&&i.value===`(`){let e=this.parseInlineMetadata(),t=e.get(`bindMaterialAs`);t&&(n=qm(t));let i=e.get(`materialPurpose`)??e.get(`purpose`);i&&(r=qm(i))}let a=[],o=this.peek();if(o&&o.kind===`punct`&&o.value===`=`){this.next();let e=this.parseValue();for(let t of Ym(e))t.primPath!==void 0&&a.push(t.primPath)}if(this.peek()?.value===`(`){let e=this.parseInlineMetadata(),t=e.get(`bindMaterialAs`);t&&(n=qm(t));let i=e.get(`materialPurpose`)??e.get(`purpose`);i&&(r=qm(i))}e.relationships.set(t,{name:t,targets:a,...n===void 0?{}:{strength:n},...r===void 0?{}:{purpose:r}})}parseAttribute(e,t){if(t.length<2)throw new Bm(`Malformed attribute near '${t.join(` `)}' in ${this.uri}: ${this.tokens.slice(Math.max(0,this.pos-8),this.pos+8).map(e=>e.value).join(` `)}`);let n=t[t.length-1],r=t[t.length-2],i,a=()=>{let e=this.parseInlineMetadata().get(`interpolation`);e&&i===void 0&&(i=qm(e))},o=this.peek();o&&o.kind===`punct`&&o.value===`(`&&a();let s,c=this.peek();if(c&&c.kind===`punct`&&c.value===`=`){this.next(),s=Qm(this.parseValue());let e=this.peek();e&&e.kind===`punct`&&e.value===`(`&&a()}n===`xformOpOrder`?e.xformOpOrder=s===void 0?[]:Zm(s):n.startsWith(`xformOp:`)?e.xformValues.set(n,{typeName:r,...s===void 0?{}:{value:s}}):e.attributes.set(n,{name:n,typeName:r,...r===`asset`?{sourceLayer:this.uri}:{},...s===void 0?{}:{value:s},...i===void 0?{}:{interpolation:i}})}parseInlineMetadata(){this.expectPunct(`(`);let e=new Map;for(;;){let t=this.peek();if(!t)throw new Bm(`Unterminated inline metadata in ${this.uri}.`);if(t.kind===`punct`&&t.value===`)`){this.next();break}if(t.kind===`string`){this.next();continue}let n=this.readMetadataKey();this.expectPunct(`=`),e.set(n,this.parseValue())}return e}parseValue(){let e=this.next();if(e.kind===`string`)return{k:`str`,v:e.value};if(e.kind===`path`)return{k:`path`,v:e.value};if(e.kind===`asset`){let t=this.peek();return t&&t.kind===`path`?(this.next(),{k:`ref`,asset:e.value,path:t.value}):{k:`ref`,asset:e.value}}if(e.kind===`punct`&&e.value===`[`)return this.parseList(`]`);if(e.kind===`punct`&&e.value===`(`)return this.parseList(`)`,!0);if(e.kind===`punct`&&e.value===`{`){let e=new Map;for(;this.peek()?.value!==`}`;){let t=this.next();for(;this.peek()?.value!==`=`;)t=this.next();this.expectPunct(`=`),e.set(t.value,this.parseValue())}return this.expectPunct(`}`),{k:`dict`,entries:e}}if(e.value===`true`)return{k:`bool`,v:!0};if(e.value===`false`)return{k:`bool`,v:!1};let t=Number(e.value);return e.value!==``&&!Number.isNaN(t)?{k:`num`,v:t}:{k:`ident`,v:e.value}}parseList(e,t=!1){let n=[];for(;;){let t=this.peek();if(!t)throw new Bm(`Unterminated list in ${this.uri}.`);if(t.kind===`punct`&&t.value===e){this.next();break}n.push(this.parseValue())}return t?{k:`tuple`,items:n}:{k:`list`,items:n}}},Gm=new Set([`def`,`over`,`class`]),Km=new Set([`prepend`,`append`,`add`,`delete`,`reorder`]);function qm(e){return e.k===`str`||e.k===`ident`||e.k===`path`?e.v:e.k===`num`||e.k===`bool`?String(e.v):e.k===`ref`?e.asset??e.path??``:``}function Jm(e){return e.k===`num`?e.v:void 0}function Ym(e){let t=[],n=e=>{e.k===`ref`?t.push({...e.asset===void 0?{}:{assetPath:e.asset},...e.path===void 0?{}:{primPath:e.path},isMaterialX:e.asset!==void 0&&e.asset.toLowerCase().endsWith(`.mtlx`)}):e.k===`path`&&t.push({primPath:e.v,isMaterialX:!1})};return e.k===`list`?e.items.forEach(n):n(e),t}function Xm(e){return e.k===`list`?e.items.map(qm):[qm(e)]}function Zm(e){return Array.isArray(e)?e.map(e=>String(e)):[String(e)]}function Qm(e){if(e.k===`dict`)throw new Bm(`Dictionary-valued attributes are not supported.`);if(e.k===`str`||e.k===`ident`||e.k===`path`)return e.k,e.v;if(e.k===`num`||e.k===`bool`)return e.v;if(e.k===`ref`)return e.asset??e.path??``;let t=[],n=[],r=!0,i=e=>{e.k===`num`?(t.push(e.v),n.push(String(e.v))):e.k===`list`||e.k===`tuple`?e.items.forEach(i):(r=!1,n.push(qm(e)))};return i(e),r?t:n}function $m(e,t){if(/^https?:\/\//i.test(e))return new URL(t,e).href;if(/^[a-z]+:\/\//i.test(t)||t.startsWith(`/`))return t;let n=e.lastIndexOf(`/`),r=((n>=0?e.slice(0,n+1):``)+t).split(`/`),i=[];for(let e of r)e===``&&i.length>0||e!==`.`&&(e===`..`?i.length>0&&i.pop():i.push(e));return i.join(`/`)}function eh(e){let t=e.xformOpOrder,n=[],r=t??[...e.xformValues.keys()];for(let t of r){let r=t.startsWith(`!invert!`),i=r?t.slice(8):t,a=e.xformValues.get(i);n.push({op:i,typeName:a?.typeName??`token`,...a?.value===void 0?{}:{value:a.value},invert:r})}return n}function th(e){let t=[];for(let n of e.attributes.values())n.name.startsWith(`primvars:`)&&t.push({name:n.name.slice(9),typeName:n.typeName,...n.interpolation===void 0?{}:{interpolation:n.interpolation}});let n=e.attributes.get(`subdivisionScheme`),r=e.attributes.get(`refinementLevel`),i=e.attributes.get(`refinementEnableOverride`);if(e.typeName===`Mesh`||n!==void 0||t.length>0)return{...n?.value===void 0?{}:{subdivisionScheme:String(n.value)},...typeof r?.value==`number`?{refinementLevel:r.value}:{},...typeof i?.value==`boolean`?{refinementEnableOverride:i.value}:{},primvars:t}}function nh(e){let t=e.relationships.get(`material:binding`);if(!t||t.targets.length===0)return;let n=t.targets[0],r=t.strength;return{target:n,...r===`weakerThanDescendants`||r===`strongerThanDescendants`?{strength:r}:{},...t.purpose===void 0?{}:{purpose:t.purpose}}}var rh=class{emit;resolveArcsFlag;comp={prims:new Map,roots:[],materials:[],arcs:new Map};constructor(e,t){this.emit=e,this.resolveArcsFlag=t}mergeLayer(e){for(let t of e.prims)this.mergePrim(t,``,e.uri)}mergePrim(e,t,n){let r=`${t}/${e.name}`,i=this.comp.prims.get(r);i||(i={path:r,name:e.name,specifier:e.specifier,apiSchemas:[],inherits:[],references:[],payloads:[],attributes:new Map,relationships:new Map,xformOps:[],children:[]},this.comp.prims.set(r,i),t===``?this.comp.roots.push(r):this.attachChild(t,r)),e.specifier===`def`&&(i.specifier=`def`),i.typeName===void 0&&e.typeName!==void 0&&(i.typeName=e.typeName),i.kind===void 0&&e.kind!==void 0&&(i.kind=e.kind);for(let t of e.apiSchemas)i.apiSchemas.includes(t)||i.apiSchemas.push(t);for(let t of e.inherits)i.inherits.includes(t)||i.inherits.push(t);for(let t of e.references)this.addReference(i,i.references,t,r,n);for(let t of e.payloads)this.addPayload(i.payloads,t,n,r);for(let[t,n]of e.attributes)i.attributes.has(t)||i.attributes.set(t,n);for(let[t,n]of e.relationships)i.relationships.has(t)||i.relationships.set(t,{name:n.name,targets:n.targets});if(i.xformOps.length===0){let t=eh(e);t.length>0&&(i.xformOps=t)}if(i.materialBinding===void 0){let t=nh(e);t&&(i.materialBinding=t)}if(i.mesh===void 0){let t=th(e);t&&(i.mesh=t)}for(let t of e.children)this.mergePrim(t,r,n)}attachChild(e,t){let n=this.comp.prims.get(e);n&&(n.children.includes(t)||n.children.push(t))}addReference(e,t,n,r,i){if(t.push(n),n.isMaterialX&&n.assetPath!==void 0&&n.primPath!==void 0){let e=n.primPath.split(`/`).filter(e=>e.length>0),t=e[e.length-1]??n.primPath;this.comp.materials.push({primPath:r,assetPath:n.assetPath,authoringLayer:i,referencedPrimPath:n.primPath,materialName:t})}else n.assetPath!==void 0&&(this.recordArc(r,{kind:`reference`,layerUri:i,assetPath:n.assetPath,...n.primPath===void 0?{}:{primPath:n.primPath}}),this.resolveArcsFlag||this.emit({level:`info`,message:`Non-MaterialX reference deferred to crate reader: ${n.assetPath}`,detail:{prim:e.path}}))}addPayload(e,t,n,r){e.push(t),t.assetPath!==void 0&&(this.recordArc(r,{kind:`payload`,layerUri:n,assetPath:t.assetPath,...t.primPath===void 0?{}:{primPath:t.primPath}}),this.resolveArcsFlag||this.emit({level:`info`,message:`Payload deferred (loaded on demand): ${$m(n,t.assetPath)}`}))}recordArc(e,t){let n=this.comp.arcs.get(e);n?n.push(t):this.comp.arcs.set(e,[t])}};async function ih(e,t,n,r,i,a){let o=new rh(n,a),s=async(e,a)=>{if(i.has(e)){n({level:`warning`,message:`Skipping already-composed layer (cycle guard): ${e}`});return}if(a>r)throw new Bm(`USDA subLayer depth exceeded ${r} at ${e}.`);i.add(e);let c;try{c=await t.read(e)}catch(t){n({level:`error`,message:`Cannot read USD layer: ${e}`,detail:t});return}if(c.startsWith(`PXR-USDC`)){n({level:`info`,message:`Binary crate layer deferred to crate reader: ${e}`});return}let l;try{l=new Wm(Um(c),e).parseLayer()}catch(t){n({level:`error`,message:`Failed to parse USDA layer: ${e}`,detail:t});return}o.mergeLayer(l);for(let t of l.metadata.subLayers)await s($m(e,t),a+1)},c;try{let n=await t.read(e);if(n.startsWith(`PXR-USDC`))throw new Bm(`Entry stage must be a text USDA layer, got binary crate: ${e}.`);c=new Wm(Um(n),e).parseLayer()}catch(t){throw t instanceof Bm?t:new Bm(`Cannot read entry stage ${e}: ${String(t)}`)}i.add(e),o.mergeLayer(c);let l=c.metadata.subLayers.map(t=>$m(e,t));for(let t of c.metadata.subLayers)await s($m(e,t),1);return{composition:o.comp,metadata:c.metadata,resolvedSubLayers:l}}function ah(e,t){e.typeName===void 0&&t.typeName!==void 0&&(e.typeName=t.typeName),e.kind===void 0&&t.kind!==void 0&&(e.kind=t.kind);for(let n of t.apiSchemas)e.apiSchemas.includes(n)||e.apiSchemas.push(n);for(let n of t.inherits)e.inherits.includes(n)||e.inherits.push(n);for(let[n,r]of t.attributes)e.attributes.has(n)||e.attributes.set(n,r);for(let[n,r]of t.relationships)e.relationships.has(n)||e.relationships.set(n,r);e.xformOps.length===0&&t.xformOps.length>0&&(e.xformOps=[...t.xformOps]),e.materialBinding===void 0&&t.materialBinding!==void 0&&(e.materialBinding=t.materialBinding),e.mesh===void 0&&t.mesh!==void 0&&(e.mesh=t.mesh)}function oh(e,t){return{path:t,name:e.name,specifier:e.specifier,...e.typeName===void 0?{}:{typeName:e.typeName},...e.kind===void 0?{}:{kind:e.kind},apiSchemas:[...e.apiSchemas],inherits:[...e.inherits],references:[...e.references],payloads:[...e.payloads],attributes:new Map(e.attributes),relationships:new Map(e.relationships),xformOps:[...e.xformOps],children:[],...e.materialBinding===void 0?{}:{materialBinding:e.materialBinding},...e.mesh===void 0?{}:{mesh:e.mesh}}}function sh(e,t,n,r,i){if(!n.prims.get(r)){i({level:`warning`,message:`Arc target prim not found: ${r}`});return}let a=e=>t.path+e.slice(r.length),o=[r];for(;o.length>0;){let i=o.pop(),s=n.prims.get(i);if(!s)continue;let c=a(i),l;if(i===r)l=t,ah(l,s);else{let t=e.prims.get(c);t?(l=t,ah(l,s)):(l=oh(s,c),e.prims.set(c,l))}for(let e of s.children){let t=a(e);l.children.includes(t)||l.children.push(t),o.push(e)}}for(let i of n.materials)(i.primPath===r||i.primPath.startsWith(`${r}/`))&&e.materials.push({...i,primPath:t.path+i.primPath.slice(r.length)})}async function ch(e,t,n,r,i){for(let[a,o]of[...e.arcs]){let s=e.prims.get(a);if(!s)continue;let c=[...o].sort((e,t)=>(e.kind===`reference`?0:1)-(t.kind===`reference`?0:1));for(let o of c){let c=$m(o.layerUri,o.assetPath);if(i.has(c)){n({level:`warning`,message:`Arc cycle guard: skipping ${o.kind} to ${c}`,detail:{prim:a}});continue}let l;try{l=await ih(c,t,n,r,new Set,!0)}catch(e){n({level:`warning`,message:`Arc layer unavailable (${o.kind}): ${c}`,detail:e});continue}await ch(l.composition,t,n,r,new Set([...i,c]));let u=o.primPath??(l.metadata.defaultPrim===void 0?l.composition.roots[0]:`/${l.metadata.defaultPrim}`);u===void 0?n({level:`warning`,message:`Arc target has no default prim: ${c}`,detail:{prim:a}}):(sh(e,s,l.composition,u,n),n({level:`info`,message:`Composed ${o.kind} arc: ${c}${o.primPath??``} -> ${a}`}))}}}async function lh(e,t){let n=t.sink??(()=>void 0),r=t.maxDepth??32,i=t.resolveArcs??!1,a=new Set,o=await ih(e,t.reader,n,r,a,i);i&&await ch(o.composition,t.reader,n,r,new Set([e]));let s={...o.metadata.defaultPrim===void 0?{}:{defaultPrim:o.metadata.defaultPrim},...o.metadata.upAxis===void 0?{}:{upAxis:o.metadata.upAxis},...o.metadata.metersPerUnit===void 0?{}:{metersPerUnit:o.metadata.metersPerUnit},subLayers:o.resolvedSubLayers};for(let e of o.composition.prims.values())for(let t of e.inherits)o.composition.prims.has(t)||n({level:`info`,message:`Dangling inherit ignored: ${t}`,detail:{prim:e.path}});return{entry:e,stage:s,prims:o.composition.prims,roots:o.composition.roots,materials:o.composition.materials}}var uh=class extends Error{name=`CrateReadError`};function dh(e){let t=e.split(/[\\/]/).pop()??e;return t.length>0?t:`crate.usd`}async function fh(e,t,n){let r=await n.loadModule(),i=dh(t),a=`/${i}`;r.FS_createDataFile(`/`,i,e,!0,!0,!0);try{let e=await r.OpenStage(a);if(!e)throw new uh(`OpenUSD-wasm could not open crate: ${t}`);try{let r=e.GetCompositionErrors?.()??[];if(r.length>0&&n.sink)for(let e of r.slice(0,8))n.sink({level:`warning`,message:`Crate composition: ${e}`,detail:{crate:t}});if(n.preserveLayer&&!e.GetRootLayer)throw new uh(`OpenUSD runtime cannot export an authored root layer.`);let i=n.preserveLayer?e.GetRootLayer().ExportToString():e.ExportToString();if(typeof i!=`string`||i.length===0)throw new uh(`OpenUSD-wasm exported empty USDA for crate: ${t}`);return i}finally{try{r.ReleaseStage(e)}catch{}}}finally{try{r.FS_unlink(a)}catch{}}}var ph=`PXR-USDC`,mh=class extends Error{name=`StageComposeError`};function hh(e){if(e.length<8)return!1;for(let t=0;t<8;t+=1)if(e[t]!==ph.charCodeAt(t))return!1;return!0}function gh(e){let{resolver:t,source:n,loadCrateModule:r,sink:i,maxDepth:a}=e,o=new TextDecoder(`utf-8`);return{async read(e){let{url:s}=t.resolve(e),c=await n.fetchBytes(s);if(hh(c)){if(!r)throw new mh(`Crate layer '${e}' requires a crate module loader (loadCrateModule).`);return fh(c,e,{preserveLayer:!0,loadModule:r,...i?{sink:i}:{},...a===void 0?{}:{maxDepth:a}})}return o.decode(c)}}}async function _h(e,t){return lh(e,{reader:gh(t),resolveArcs:!0,...t.sink?{sink:t.sink}:{},...t.maxDepth===void 0?{}:{maxDepth:t.maxDepth}})}var vh;function yh(e){return typeof e==`object`&&!!e&&[`FS_createDataFile`,`FS_unlink`,`OpenStage`,`ReleaseStage`,`GetBuildInfoJson`].every(t=>t in e&&typeof Reflect.get(e,t)==`function`)}function bh(){return vh??=(async()=>{let e=new URL(`./openusd/index.js`,document.baseURI).href,t=await vo(()=>import(e),[],import.meta.url);if(typeof t!=`object`||!t||!(`getUsdModule`in t)||typeof t.getUsdModule!=`function`)throw Error(`Invalid OpenUSD bindings: missing getUsdModule.`);let n=await t.getUsdModule({setStatus:()=>{}});if(!yh(n))throw Error(`Invalid OpenUSD WASM module.`);return n})().catch(e=>{throw vh=void 0,e}),vh}function xh(e,t,n){let r=(t-Math.floor(t))*e.width-.5,i=(n-Math.floor(n))*e.height-.5,a=Math.floor(r),o=Math.floor(i),s=(t,n)=>(t=(t%e.width+e.width)%e.width,n=(n%e.height+e.height)%e.height,e.data[(n*e.width+t)*4]/255),c=r-a,l=i-o;return(s(a,o)*(1-c)+s(a+1,o)*c)*(1-l)+(s(a,o+1)*(1-c)+s(a+1,o+1)*c)*l}function Sh(e,t,n,r,i={}){if(t.componentType!==`uint8`||t.channels!==4||t.width<1||t.height<1||t.data.length!==t.width*t.height*4)throw Error(`Displacement requires a nonempty RGBA8 height map.`);if(!Number.isFinite(n))throw Error(`Displacement scale must be finite.`);if(n===0)return{...e,prototypeId:r};let a=e.streams.find(e=>e.name===`position`)?.data,o=e.streams.find(e=>e.name===`normal`)?.data,s=e.streams.find(e=>e.name===`uv`)?.data;if(!a||!o||!s)throw Error(`Displacement requires positions, normals and UVs: ${e.primPath}`);let c=new Map,l=[];for(let t=0;t<e.vertexCount;t++){let e=Array.from(a.subarray(t*3,t*3+3),e=>Math.round(e*1e5)).join(`,`);l.push(e);let n=c.get(e);n?n.push(t):c.set(e,[t])}let u=a.slice();for(let e of c.values()){let r=[0,0,0];for(let a of e){let c=(xh(t,s[a*2]*(i.uvScale?.[0]??1)+(i.uvOffset?.[0]??0),s[a*2+1]*(i.uvScale?.[1]??1)+(i.uvOffset?.[1]??0))-.5)*n;for(let t=0;t<3;t++)r[t]+=o[a*3+t]*c/e.length}let c=e[0];for(let t of e)for(let e=0;e<3;e++)u[t*3+e]=a[c*3+e]+r[e]}let d=l.map((e,t)=>`${e}|${Array.from(o.subarray(t*3,t*3+3),e=>Math.round(e*1e5)).join(`,`)}`),f=new Map;for(let t=0;t<e.indices.length;t+=3){let n=e.indices[t],r=e.indices[t+1],i=e.indices[t+2],a=[0,1,2].map(e=>u[r*3+e]-u[n*3+e]),o=[0,1,2].map(e=>u[i*3+e]-u[n*3+e]),s=[a[1]*o[2]-a[2]*o[1],a[2]*o[0]-a[0]*o[2],a[0]*o[1]-a[1]*o[0]];for(let e of[n,r,i]){let t=d[e],n=f.get(t)??[0,0,0];for(let e=0;e<3;e++)n[e]+=s[e];f.set(t,n)}}let p=o.slice();d.forEach((e,t)=>{let n=f.get(e);if(!n)return;let r=Math.hypot(...n);r>1e-20&&p.set(n.map(e=>e/r),t*3)});let m=jt({points:Array.from(u),faceVertexCounts:Array(e.triangleCount).fill(3),faceVertexIndices:Array.from(e.indices),normals:{name:`normals`,interpolation:`vertex`,elementSize:3,values:Array.from(p)},primvars:e.streams.filter(e=>![`position`,`normal`,`tangent`].includes(e.name)).map(e=>({name:e.name===`uv`?`st`:e.name,interpolation:`vertex`,elementSize:e.components,values:Array.from(e.data)}))});return gn(r,e.primPath,{...m,subsets:e.subsets,subdivision:e.subdivision})}async function Ch(e,t){if(![...e.materials.values()].some(e=>e.displacement))return e;let n=new Map(e.geometries),r=new Map(e.materials),i=new Map;for(let[e,n]of r){if(!n.displacement)continue;let a=n.displacement.file;if(!i.has(a)){let e=await t.decode(a);if(!e)throw Error(`Invalid displacement map: ${a}`);i.set(a,e)}let{displacement:o,...s}=n;r.set(e,{...s,...n.surfaceModule?{sceneShader:Ce(n.surfaceModule)}:{}})}let a=new Set,o=e.instances.map(t=>{let r=t.materialKey?e.materials.get(t.materialKey)?.displacement:void 0,o=n.get(t.prototypeId);if(!r||!o)return t;a.add(t.prototypeId);let s=`${t.prototypeId}::displacement::${t.materialKey}`;return n.has(s)||n.set(s,Sh(o,i.get(r.file),r.scale,s,r)),{...t,prototypeId:s}}),s=new Set(o.map(e=>e.prototypeId));for(let e of a)s.has(e)||n.delete(e);let c=pt(o.map(e=>mn(n.get(e.prototypeId)?.bounds??{min:[0,0,0],max:[0,0,0]},e.transform)));return{...e,geometries:n,materials:r,instances:o,tlas:c}}var wh=new Set([`float`,`integer`,`boolean`,`color3`,`vector2`,`vector3`,`vector4`]);function Th(e){return wh.has(e)}function Eh(e){let t=e.surfaceGraph?.nodes.get(e.resolvedSurface?.nodeId??``);return(e.parameters??[]).filter(e=>{if(e.nodeId)return!1;let n=t?.inputs.find(t=>t.name===e.input);return n?.source.kind===`value`&&!n.interfaceName})}function Dh(e,t){let n=e.type===`color3`?3:e.type.startsWith(`vector`)?Number(e.type.at(-1)):1;if(t.length!==n||!t.every(Number.isFinite))throw Error(`Invalid value for ${e.label}`);if(e.type===`integer`&&!Number.isInteger(t[0]))throw Error(`${e.label} requires an integer.`);if(e.type===`boolean`&&t[0]!==0&&t[0]!==1)throw Error(`${e.label} requires a boolean.`);return[...t]}function Oh(e){let t=new Map(e.materials),n=e.instances.map(e=>{let n=e.materialKey?t.get(e.materialKey):void 0;if(!n?.resolvedSurface||!n.surfaceGraph)return e;let r=`${e.materialKey}::editor::${e.primPath}`,i=[],a=new Map(n.resolvedSurface.inputs),o=n.surfaceGraph.nodes.get(n.resolvedSurface.nodeId);for(let[e,t]of a){let n=o?.inputs.find(t=>t.name===e);if(n?.interfaceName||n?.source.kind===`interface`||n?.source.kind===`connection`||t.source.kind!==`value`&&t.source.kind!=="default")continue;let r=`parameter_${i.length}`,s=t.type===`boolean`||t.type===`integer`;i.push({id:`surface:${e}`,label:e,type:t.type,input:e,value:[...t.source.value],initial:[...t.source.value],update:s?`rebuild`:`uniform`,...s?{}:{uniform:r}}),s||a.set(e,{...t,parameter:r})}for(let[e,t]of n.surfaceGraph.nodes){if(e===n.resolvedSurface.nodeId)continue;let r=[...t.inputs,...(t.nodeDef?.inputs??[]).filter(e=>e.value!==void 0&&!e.geomprop&&!t.inputs.some(t=>t.name===e.name)).map(e=>({...e,source:{kind:`value`,type:e.type,value:e.value}}))];for(let t of r){if(`interfaceName`in t&&t.interfaceName||t.source.kind!==`value`||!Th(t.type))continue;let n=t.source.value.trim()===`true`?[1]:t.source.value.trim()===`false`?[0]:t.source.value.split(`,`).map(Number),r={id:JSON.stringify([e,t.name]),label:`${e} / ${t.name}`,type:t.type,value:n,initial:[...n],update:`rebuild`,nodeId:e,input:t.name};Dh(r,n),i.push(r)}}let s={...n.resolvedSurface,inputs:a};return t.set(r,kh({...n,unitKey:r,boundPrims:[e.primPath],resolvedSurface:s,parameters:i})),{...e,materialKey:r}}),r=new Set(n.map(e=>e.materialKey));for(let e of t.keys())r.has(e)||t.delete(e);return{...e,instances:n,materials:t}}function kh(e){if(!e.surfaceGraph||!e.resolvedSurface)throw Error(`Missing editable material graph.`);let t=Xi(e.surfaceGraph,e.resolvedSurface),n=Ce(t,{displacement:e.displacement!==void 0});return{...e,surfaceModule:t,sceneShader:n,variant:{...e.variant,pipelineKey:ke(n.code)}}}function Ah(e,t){if(!e.resolvedSurface||!e.surfaceGraph||!e.parameters)throw Error(`Material has no editable parameters.`);let n=new Map(e.resolvedSurface.inputs),r=new Map(e.surfaceGraph.nodes);for(let n of t.keys())if(!e.parameters.some(e=>e.id===n))throw Error(`Unknown parameter: ${n}`);let i=e.parameters.map(e=>{let i=t.get(e.id);if(!i)return e;let a=Dh(e,i);if(e.nodeId){let t=r.get(e.nodeId),n={name:e.input,type:e.type,source:{kind:`value`,type:e.type,value:e.type===`boolean`?String(a[0]===1):a.join(`, `)},provenance:{namePath:`${e.nodeId}/${e.input}`}};r.set(e.nodeId,{...t,inputs:t.inputs.some(t=>t.name===e.input)?t.inputs.map(t=>t.name===e.input?{...t,source:n.source}:t):[...t.inputs,n]})}else{let t=n.get(e.input);n.set(e.input,{...t,source:{kind:`value`,value:a}})}return{...e,value:a}}),a={...e.resolvedSurface,inputs:n},o={...e.surfaceGraph,nodes:r},s=e.displacement?lo(o):void 0;return{...e,parameters:i,resolvedSurface:a,surfaceGraph:o,...s?{displacement:s}:{}}}function jh(e,t){let n=[],r=0;for(let t of e){let e=/^(f32|i32|u32|vec([234])<f32>|vec([234])f)$/.exec(t.wgslType);if(!e)throw Error(`Unsupported parameter uniform type: ${t.wgslType}`);let i=Number(e[2]??e[3]??1),a=i===3?16:i*4;r=Math.ceil(r/a)*a,n.push({field:t,offset:r,count:i}),r+=i*4}let i=new ArrayBuffer(Math.max(16,Math.ceil(r/16)*16)),a=new DataView(i);for(let{field:e,offset:r,count:i}of n){let n=t(e);if(n.length!==i||!n.every(Number.isFinite))throw Error(`Invalid uniform: ${e.name}`);for(let t=0;t<i;t++)e.wgslType===`i32`?a.setInt32(r+t*4,n[t],!0):e.wgslType===`u32`?a.setUint32(r+t*4,n[t],!0):a.setFloat32(r+t*4,n[t],!0)}return i}function Mh(e){return jh(e.surfaceModule?.uniforms??[],t=>{let n=e.parameters?.find(e=>e.uniform===t.name);if(!n)throw Error(`Missing material parameter: ${t.name}`);return n.value})}var Nh=`./materialx/`,Ph=`${Nh}JsMaterialXCore.js`,Fh=Nh,Ih=`${Nh}libraries`,Lh=e=>new URL(e,document.baseURI).href,Rh=new Ko,zh=new Wo({maxBytes:134217728,onDiagnostic:e=>console.warn(e.message)}),Bh=class extends Error{name=`MissingTextureError`};function Vh(e){let t=e.lastIndexOf(`/`);return t>=0?e.slice(0,t+1):``}function Hh(e,t){return t.startsWith(`/`)||/^https?:/.test(t)?t:e+t.replace(/^\.\//,``)}function Uh(e,t){let n=e.attributes.get(t)?.value;return Array.isArray(n)?n.map(e=>Number(e)):[]}function Wh(e){return{meshFor(t){let n=e.prims.get(t);if(!n)return;let r=Uh(n,`points`),i=Uh(n,`faceVertexCounts`),a=Uh(n,`faceVertexIndices`);if(r.length===0||i.length===0||a.length===0)return;let o=n.attributes.get(`orientation`)?.value===`leftHanded`,s=Uh(n,`normals`),c=n.attributes.get(`normals`)?.interpolation,l=s.length>0?{name:`normals`,interpolation:c??`faceVarying`,values:s,elementSize:3,...n.attributes.has(`normals:indices`)?{indices:Uh(n,`normals:indices`)}:{}}:void 0,u=Uh(n,`primvars:st`),d=n.attributes.get(`primvars:st`)?.interpolation,f=u.length>0?{name:`st`,interpolation:d??`faceVarying`,values:u,elementSize:2,...n.attributes.has(`primvars:st:indices`)?{indices:Uh(n,`primvars:st:indices`)}:{}}:void 0;return{points:r,faceVertexCounts:i,faceVertexIndices:a,...o?{leftHanded:!0}:{},...l?{normals:l}:{},...f?{primvars:[f]}:{}}}}}function Gh(e){let t=Lo(e);if(!t)return{...ne,baseColor:[...ne.baseColor]};let n=Po(t);return{baseColor:[n.baseColor[0],n.baseColor[1],n.baseColor[2]],metalness:n.metalness,roughness:n.roughness,transmission:n.transmission,subsurface:n.subsurface,ior:n.ior,specular:n.specular}}function Kh(e,t,n,r=``){let i=/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(e);return new URL(i?e:r+e,n??t).href}function qh(e,t,n){let r=new DOMParser().parseFromString(e,`application/xml`);if(r.querySelector(`parsererror`))throw Error(`Invalid MaterialX XML.`);for(let e of r.querySelectorAll(`[type="filename"][value]`)){let r=e.getAttribute(`value`);if(!r)continue;let i=e;for(;i&&!i.hasAttribute(`fileprefix`);)i=i.parentElement;let a=i?.getAttribute(`fileprefix`)??``;e.setAttribute(`value`,Kh(r,new URL(t,window.location.href).href,n,a))}for(let e of r.querySelectorAll(`[fileprefix]`))e.removeAttribute(`fileprefix`);return new XMLSerializer().serializeToString(r)}async function Jh(e,t,n,r=()=>{},i){let a=Vh(t),o=new Map,s=new Map,c=[];for(let r of e.materials){let e=new URL(r.assetPath,new URL(r.authoringLayer??t,document.baseURI)).href,a=Vh(e);c.includes(a)||c.push(a);try{let t=await fetch(e);if(!t.ok)throw Error(`HTTP ${t.status}: ${e}`);let n=qh(await t.text(),a,r.authoringLayer?i:void 0);s.set(r.assetPath,n),o.set(r.materialName,Gh(n))}catch(t){throw n({level:`error`,message:`Failed to load MaterialX: ${e}`,detail:String(t)}),t}}let l=ps(e,n);l.length>0&&!c.includes(a)&&c.push(a);for(let t of l)s.set(t.reference.assetPath,qh(t.xml,a)),e.materials.push(t.reference),o.set(t.reference.materialName,Gh(t.xml));let u=await So({moduleUrl:Lh(Ph),locateFile:e=>Lh(Fh+e),onDiagnostic:n});return{documents:await fo({core:u,libraries:await Ao(u,{sources:Do(Ih),fetchText:async e=>{let t=await fetch(e);if(!t.ok)throw Error(`HTTP ${t.status}: ${e}`);return t.text()},onDiagnostic:n}),texts:s,sink:n}),imageProvider:{async decode(e){for(let t of c){let r=Hh(t,e);try{return await Rh.get(r,async e=>{let t=await fetch(r,{signal:e});if(t.status===404)throw new Bh(`Texture not found: ${r}`);if(!t.ok)throw Error(`HTTP ${t.status} for texture ${r}`);try{return await jo(await t.blob(),r)}catch(e){throw n({level:`error`,message:`Texture decode failed: ${r}`,detail:{error:String(e)}}),e}})}catch(e){if(e instanceof Bh)continue;throw e}}r(`Texture introuvable: ${e}`)}},surfaceFor:e=>o.get(e.materialName)??ne}}async function Yh(e,t,n,r){let i=new Map,a=new Map,o=[],s=t.surfaceModule;if(!s)return{textureViews:i,samplers:a,textures:o};for(let t of s.textures){let a=t.fileRef;if(a===void 0)continue;let s=r.get(a);r.has(a)||(s=await n.decode(a)??void 0,r.set(a,s));let c=s?.width??1,l=s?.height??1,u=e.createTexture({size:[c,l],format:t.colorSpace===`srgb_texture`?`rgba8unorm-srgb`:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});o.push(u),s&&s.componentType===`uint8`&&s.channels===4&&e.queue.writeTexture({texture:u},s.data,{bytesPerRow:c*4,rowsPerImage:l},[c,l,1]),i.set(t.name,u.createView())}for(let t of s.samplers)a.set(t.name,e.createSampler(Fa(t.sampler??{})));return{textureViews:i,samplers:a,textures:o}}async function Xh(e,t,n){let r=e.find(e=>e.type===`dome`&&e.textureFile);if(!r?.textureFile)return;let i=new URL(r.textureSourceLayer??t,document.baseURI).href,a=async e=>{let t=new URL(e,i).href,r=zh.has(t),a=performance.now();try{let e=await zh.get(t,async e=>{let n=await fetch(t,{signal:e});if(!n.ok)throw Error(`HTTP ${n.status}`);let r=await n.arrayBuffer(),i;if(/\.exr(?:[?#]|$)/i.test(t)){let{EXRLoader:e}=await vo(async()=>{let{EXRLoader:e}=await import(`./EXRLoader-BC7o5GtY.js`);return{EXRLoader:e}},[],import.meta.url),n=new e().setDataType(Ts).parse(r);if(n.width===void 0||n.height===void 0||!(n.data instanceof Float32Array)||n.data.length!==n.width*n.height*4)throw Error(`Invalid RGBA float EXR environment: ${t}`);let a=new Float32Array(n.width*n.height*3);for(let e=0;e<n.height;e++)for(let t=0;t<n.width;t++){let r=((n.height-1-e)*n.width+t)*4;a.set(n.data.subarray(r,r+3),(e*n.width+t)*3)}i={width:n.width,height:n.height,data:a}}else i=Xo(new Uint8Array(r));return{value:i,size:i.data.byteLength}});return performance.measure(`assets:environment-cache`,{start:a,end:performance.now(),detail:{hit:r,url:t,bytes:e.data.byteLength}}),e}catch(e){n({level:`warning`,message:`Failed to load envmap ${t}`,detail:String(e?.message??e)});return}},[o,s]=await Promise.all([a(r.textureFile),r.irradianceFile?a(r.irradianceFile):void 0]);if(o)return{image:o,sh:es(s??o),averageRadiance:ts(s??o),tint:[...r.color],intensity:r.intensity*2**r.exposure}}function Zh(e,t){let n=new Map(e.prims),r=[...e.materials];for(let[e,i]of t){let t=n.get(e);if(!t||t.typeName!==`Mesh`&&!t.mesh)throw Error(`Unknown mesh: ${e}`);let a=`${e}/__MaterialOverride`;n.set(e,{...t,materialBinding:{target:a}}),r.push({primPath:a,...i,referencedPrimPath:`/${i.materialName}`})}return{...e,prims:n,materials:r}}async function Qh(e,t,n=()=>{},r=new Map,i={}){let a=performance.now(),o=!1,s=e=>{e.level===`error`&&(o=!0),t(e)},c=await _h(e,{resolver:new zm({rootUrl:Vh(e),onDiagnostic:s}),source:{fetchBytes:async e=>{let t=await fetch(e);if(!t.ok)throw Error(`HTTP ${t.status} for ${e}`);return new Uint8Array(await t.arrayBuffer())}},loadCrateModule:i.loadCrateModule??bh,sink:s});if(o)throw Error(`USD composition failed. See scene diagnostics.`);let l=Zh(c,r),u=performance.now();performance.measure(`usd:composition`,{start:a,end:u,detail:{entry:e,prims:l.prims.size}});let d=Uo(l,{sink:t}),f=ka(l,{sink:t}),p=await Jh(l,e,t,n,i.textureRoot),m=performance.now();performance.measure(`usd:materials`,{start:u,end:m,detail:{entry:e,documents:l.materials.length}});let h=await _n(l,{meshSource:await km(l,Wh(l),t),materialCompiler:uo({documents:p.documents,sink:t}),sink:t});un(h);let g=i.editableParameters?Oh(h):void 0,_=await Ch(g??h,p.imageProvider),v=await Xh(d,e,t);return performance.measure(`usd:resources`,{start:m,end:performance.now(),detail:{entry:e,geometries:_.geometries.size,materials:_.materials.size,pendingMaterials:_.pendingMaterials.length,triangles:[..._.geometries.values()].reduce((e,t)=>e+t.indices.length/3,0),lights:d.length,cameras:f.length,environment:v!==void 0}}),{entry:e,scene:l,resources:_,lights:d,cameras:f,mtlx:p,...g?{parameterResources:g}:{},...v?{environment:v}:{}}}function $h(e){return{requiredLimits:{maxStorageBufferBindingSize:e.limits.maxStorageBufferBindingSize,maxBufferSize:e.limits.maxBufferSize,maxStorageBuffersPerShaderStage:e.limits.maxStorageBuffersPerShaderStage}}}function eg(e,t){let n=Math.min(e.limits.maxStorageBufferBindingSize,e.limits.maxBufferSize);if(t>n)throw Error(`Scene storage buffer requires ${t} bytes, exceeding the GPU device limit of ${n} bytes.`)}function tg(e){let{width:t,height:n,data:r}=e,i=new Float32Array(t*n),a=0;for(let e=0;e<i.length;e++){let t=e*3;a+=Math.max(0,.212671*r[t]+.71516*r[t+1]+.072169*r[t+2]),i[e]=a}return{cdf:i,totalSum:a,width:t,height:n}}export{_n as $,jo as A,wa as B,Ds as C,Uo as D,ps as E,fo as F,oa as G,Ca as H,uo as I,ra as J,ya as K,La as L,Do as M,So as N,Lo as O,vo as P,Br as Q,Fa as R,zs as S,Os as T,Sa as U,ka as V,xa as W,Qr as X,ai as Y,Xr as Z,kf as _,Qh as a,Ce as at,Es as b,Yh as c,ue as ct,Mh as d,l as dt,bn as et,jh as f,h as ft,km as g,lh as h,p as ht,Xh as i,Ee as it,Oo as j,Po as k,Ah as l,de as lt,Ch as m,m as mt,eg as n,un as nt,Wh as o,me as ot,Eh as p,t as pt,sa as q,$h as r,vn as rt,qh as s,ne as st,tg as t,Sn as tt,kh as u,fe as ut,nu as v,ks as w,xs as x,Ts as y,Pa as z};
//# sourceMappingURL=environment-cdf-QOE8J7Pm.js.map