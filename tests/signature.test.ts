import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { parseSignaturePaste, rtfImages } from '../src/lib/signaturePaste';

/** A small solid PNG (as bytes). */
function pngBytes(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h, 40);
  for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const dataUrl = (b: Buffer, type = 'png') => `data:image/${type};base64,${b.toString('base64')}`;

/** How Word puts a picture in RTF: the PNG in hex, then a metafile copy for older readers. */
const rtfPict = (b: Buffer, blip = 'pngblip') =>
  `{\\*\\shppict{\\pict{\\*\\picprop\\shplid1025{\\sp{\\sn shapeType}{\\sv 75}}}\\picscalex100\\picscaley100\\picw3175\\pich1191\\picwgoal1800\\pichgoal675\\${blip}\\bliptag-1834512{\\*\\blipuid 92a8b6f0c1}${b
    .toString('hex')
    .replace(/(.{128})/g, '$1\r\n')}}}{\\nonshppict{\\pict\\picscalex100\\picscaley100\\picw3175\\pich1191\\wmetafile8\\bliptag-1834512 010009000003${'ab'.repeat(200)}}}`;
const rtfDoc = (...parts: string[]) => `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}\\pard\\plain ${parts.join('\\par ')}}`;

/** The HTML Word puts on the clipboard: the pictures only as links to temporary files. */
const wordHtml = (body: string) =>
  `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset=utf-8><style><!-- p.MsoNormal {margin:0cm;} --></style></head><body lang=EN-NZ><!--StartFragment-->${body}<!--EndFragment--></body></html>`;
const wordImg = (n: number) =>
  `<span style='mso-no-proof:yes'><!--[if gte vml 1]><v:shape id="Picture_x0020_${n}" type="#_x0000_t75" style='width:90pt;height:33.75pt'><v:imagedata src="file:///C:/Users/BEN~1/AppData/Local/Temp/msohtmlclip1/01/clip_image00${n}.png" o:title=""/></v:shape><![endif]--><![if !vml]><img width=120 height=45 src="file:///C:/Users/BEN~1/AppData/Local/Temp/msohtmlclip1/01/clip_image00${n + 1}.png" v:shapes="Picture_x0020_${n}"><![endif]></span>`;

const sig1 = pngBytes(30, 10);
const sig2 = pngBytes(24, 12);

describe('pasting a signature', () => {
  it('reads Word: the name, the lines under it, and the picture from the RTF copy', () => {
    const html = wordHtml(
      `<p class=MsoNormal>Ngā mihi,<o:p></o:p></p><p class=MsoNormal>${wordImg(1)}<o:p></o:p></p><p class=MsoNormal><b>Sam Taylor<o:p></o:p></b></p><p class=MsoNormal>Environmental Scientist<o:p></o:p></p><p class=MsoNormal>Example Environmental Ltd &#8211; <i>Riverton</i><o:p></o:p></p>`,
    );
    const rtf = rtfDoc('Ng\\u257?a mihi,', rtfPict(sig1), '{\\b Sam Taylor}', 'Environmental Scientist');
    const r = parseSignaturePaste({ html, rtf, text: 'Ngā mihi,\r\n\r\nSam Taylor\r\nEnvironmental Scientist' });
    expect(r.people).toEqual([{ name: 'Sam Taylor', details: ['Environmental Scientist', 'Example Environmental Ltd – *Riverton*'], images: [0] }]);
    expect(r.images).toEqual([dataUrl(sig1)]); // not the metafile copy
  });

  it('finds PNG and JPEG pictures in RTF, skipping metafile copies', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(80, 7)]);
    expect(rtfImages(rtfDoc(rtfPict(sig1), 'text', rtfPict(jpeg, 'jpegblip')))).toEqual([dataUrl(sig1), dataUrl(jpeg, 'jpeg')]);
    expect(rtfImages(rtfDoc('{\\pict\\wmetafile8 0100090000}'))).toEqual([]);
    expect(rtfImages('not rtf')).toEqual([]);
  });

  it('reads an email signature: skips the greeting, prefers the image above the name to the logo below', () => {
    const html = `<div dir="ltr"><div>Kind regards,</div><div><img src="${dataUrl(sig1)}" width="120"></div><div><b>Sam Taylor</b> | <span style="font-weight:700">BSc (Hons)</span></div><div>Environmental Scientist</div><div>M +64 21 123 4567</div><div><img src="https://example.com/logo.png" alt="Example Ltd"></div><img src="https://track.example.com/p.gif" width="1" height="1"><div style="display:none">hidden preheader</div><p style="font-size:8px">This email and any attachments are confidential and may be legally privileged. If you are not the intended recipient, please notify the sender immediately and delete it from your system.</p></div>`;
    const r = parseSignaturePaste({ html, text: '' });
    expect(r.people).toEqual([{ name: 'Sam Taylor | BSc (Hons)', details: ['Environmental Scientist', 'M +64 21 123 4567'], images: [0, 1] }]);
    expect(r.images).toEqual([dataUrl(sig1), 'https://example.com/logo.png']);
  });

  it('keeps one person when an email signature is laid out in a table', () => {
    const html = `<table><tr><td><img src="https://example.com/logo.png"></td><td><p><strong>Jane Doe</strong></p><p>Principal Environmental Consultant</p></td></tr></table>`;
    expect(parseSignaturePaste({ html }).people).toEqual([{ name: 'Jane Doe', details: ['Principal Environmental Consultant'], images: [0] }]);
  });

  it('reads a sign-off table with a person per column', () => {
    const html = wordHtml(
      `<table class=MsoTableGrid border=0><tr><td width=200><p>Prepared by:</p></td><td width=200><p>Reviewed by:</p></td></tr><tr><td><p>${wordImg(1)}</p></td><td><p>${wordImg(3)}</p></td></tr><tr><td><p><b>Sam Taylor</b></p></td><td><p><b>Jane Doe</b></p></td></tr><tr><td><p>Environmental Scientist</p></td><td><p>Principal Environmental Consultant</p></td></tr><tr><td><p>Date: 12/10/2026</p></td><td><p>Date: 13/10/2026</p></td></tr></table>`,
    );
    const r = parseSignaturePaste({ html, rtf: rtfDoc(rtfPict(sig1), rtfPict(sig2)) });
    expect(r.people).toEqual([
      { role: 'Prepared by', name: 'Sam Taylor', details: ['Environmental Scientist'], date: '12/10/2026', images: [0] },
      { role: 'Reviewed by', name: 'Jane Doe', details: ['Principal Environmental Consultant'], date: '13/10/2026', images: [1] },
    ]);
    expect(r.images).toEqual([dataUrl(sig1), dataUrl(sig2)]);
  });

  it('reads a sign-off table with a person per row, and one with a person per cell', () => {
    const rows = `<table><tr><td></td><td>Name</td><td>Signature</td><td>Date</td></tr><tr><td>Prepared by</td><td>Sam Taylor</td><td><img src="${dataUrl(sig1)}"></td><td>12 October 2026</td></tr><tr><td>Approved for release by</td><td>John Smith</td><td></td><td>12 October 2026</td></tr></table>`;
    expect(parseSignaturePaste({ html: rows }).people).toEqual([
      { role: 'Prepared by', name: 'Sam Taylor', details: [], date: '12 October 2026', images: [0] },
      { role: 'Approved for release by', name: 'John Smith', details: [], date: '12 October 2026', images: [] },
    ]);
    const cells = `<table><tr><td><p>Prepared by: Sam Taylor</p><p>Environmental Scientist</p></td><td><p>Reviewed by</p><p><img src="${dataUrl(sig2)}"></p><p>Jane Doe</p><p>Name: ignored as a second name</p></td></tr></table>`;
    expect(parseSignaturePaste({ html: cells }).people).toEqual([
      { role: 'Prepared by', name: 'Sam Taylor', details: ['Environmental Scientist'], images: [] },
      { role: 'Reviewed by', name: 'Jane Doe', details: ['Name: ignored as a second name'], images: [0] },
    ]);
  });

  it('reads plain text, and a table copied as text', () => {
    expect(parseSignaturePaste({ text: 'Regards\n\nSam Taylor\nJob title: Environmental Scientist\nExample Ltd\n' }).people).toEqual([{ name: 'Sam Taylor', details: ['Environmental Scientist', 'Example Ltd'], images: [] }]);
    expect(parseSignaturePaste({ text: 'Prepared by:\tReviewed by:\r\nSam Taylor\tJane Doe\r\nScientist\tPrincipal\r\n' }).people).toEqual([
      { role: 'Prepared by', name: 'Sam Taylor', details: ['Scientist'], images: [] },
      { role: 'Reviewed by', name: 'Jane Doe', details: ['Principal'], images: [] },
    ]);
    expect(parseSignaturePaste({ text: '  ' }).people).toEqual([]);
  });

  it('takes a lone pasted image as the signature', () => {
    const r = parseSignaturePaste({ html: `<meta charset="utf-8"><img src="${dataUrl(sig1)}"/>` });
    expect(r.people).toEqual([{ details: [], images: [0] }]);
    expect(r.images).toEqual([dataUrl(sig1)]);
  });
});
