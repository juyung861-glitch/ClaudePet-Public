'use strict';
// electron-builder afterPack: Windows 실행 파일에 아이콘·버전 정보를 넣는다.
// (리눅스에서 빌드할 때 wine 없이 하려고 rcedit 대신 순수 JS 라이브러리 resedit 사용)
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Data, Resource } = await import('pe-library').then(async (pe) => {
    const re = await import('resedit');
    return { NtExecutable: pe.NtExecutable, NtExecutableResource: pe.NtExecutableResource, Data: re.Data, Resource: re.Resource };
  });
  const productName = context.packager.appInfo.productFilename;
  const version = context.packager.appInfo.version;
  const exePath = path.join(context.appOutDir, `${productName}.exe`);
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const vis = Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis[0] || Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'ClaudePet - Claude Code desktop pet',
    ProductName: 'ClaudePet',
    CompanyName: 'ClaudePet',
    OriginalFilename: `${productName}.exe`,
    InternalName: productName,
    FileVersion: version,
    ProductVersion: version,
    LegalCopyright: 'MIT License',
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • afterPack: ${productName}.exe 아이콘·버전 정보 설정`);
};
