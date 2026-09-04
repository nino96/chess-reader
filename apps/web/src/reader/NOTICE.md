# Third-party notices — self-hosted pdf.js runtime assets

`apps/web/vite.config.ts` copies a small, explicit allow-list of runtime assets
out of the pinned `pdfjs-dist` package and serves them from this app's own
origin. `src/reader/pdfAssets.ts` builds their URLs and `src/reader/pdfDocument.ts`
hands those URLs to pdf.js.

The bytes are never committed to this repository. They are copied at build time
from the lockfile-pinned package, so their provenance is exactly the version
recorded in `pnpm-lock.yaml`, and the hashes below can be re-derived at any time
with `sha256sum` against `node_modules`.

Package: `pdfjs-dist` 6.3.289 — https://github.com/mozilla/pdf.js — Apache-2.0.
The library itself is a normal pinned dependency covered by `pnpm check:licenses`;
this file covers the asset files we redistribute as static files, each of which
carries its own upstream license.

## Why these assets are self-hosted at all

pdf.js 6 decodes JBIG2 (bitonal scans, which is what scanned chess books use)
and JPEG 2000 images in WebAssembly loaded from the `wasmUrl` prefix. With that
option unset, the worker builds the literal URL `"nulljbig2.wasm"`, the fetch
fails, its `import("nulljbig2_nowasm_fallback.js")` fallback also fails, and the
decoder resolves to `null` — so the image is silently never drawn and the page
shows blank white space where a diagram should be. That was a real defect
reported against the issue #2 slice. See `WasmImage#instantiateWasm` in the
package's `build/pdf.worker.mjs`.

## What is deliberately NOT shipped

- `wasm/quickjs-eval.wasm` and `wasm/quickjs-eval.js` — a JavaScript engine
  pdf.js uses only to run scripts embedded in a PDF, and only when
  `enableScripting` is true, which this app never sets. AGENTS.md requires
  treating book content as hostile input, so this app does not carry an
  interpreter for it. Absent, the feature fails closed rather than quietly
  running book-supplied script.
- `standard_fonts/` — contains GPLv2-licensed Liberation fonts. Their exception
  covers _documents that embed the font_; it does not exempt redistributing the
  font files themselves, which this app would be doing. That is a genuine
  copyleft obligation, it is not required by any known defect, and it needs its
  own reviewed decision rather than arriving as a side effect of a bug fix.
  Leaving `standardFontDataUrl` unset preserves current behaviour: `useSystemFonts`
  defaults to true in browsers, so non-embedded standard fonts fall back to
  system fonts.
- `cmaps/` — 1.5 MB of CJK and other multi-byte character maps, not required by
  any known defect.

Both omissions are reader-quality questions that belong to issue #5, where
reader behaviour on arbitrary books is the actual subject.

## Shipped files and hashes

```
e6bee67724a7b5436fe8162638e3708cfc8d52b6342db69a49715e30ff27cfdc *wasm/jbig2.wasm
04c795a6657a4553a64b781ea3e85256203d913c3b71b72b85fa3ce00622f458 *wasm/jbig2_nowasm_fallback.js
004a0e62db930ba9ff2a22212f4554d0bb57a0635a8287caf70f98117cee14ba *wasm/openjpeg.wasm
0f998419819da4491d8302222aa9e2ff2494685641aa2a6c21c3760c29f3e319 *wasm/openjpeg_nowasm_fallback.js
663d86126d5f5fcb1c61490f94353e2a8375660b8c5498ab3ebab5a34b08800e *wasm/qcms_bg.wasm
73e1ba37d2bad5bab2a964f40a9eed96209666efc067c3322626214bbef234a0 *iccs/CGATS001Compat-v2-micro.icc
```

Plus the license files listed below, copied alongside the binaries they cover.

---

## jbig2.wasm, jbig2_nowasm_fallback.js

JBIG2 image decoder. Upstream code from PDFium (https://pdfium.googlesource.com/pdfium/),
dual licensed BSD-3-Clause and Apache-2.0; the WebAssembly binding around it is
Mozilla's, under Apache-2.0.

**Obligation.** BSD-3-Clause requires reproducing the copyright notice, the
conditions, and the disclaimer in binary redistributions. Apache-2.0 §4(d)
requires carrying attribution notices. Both are satisfied by reproducing the
upstream text verbatim below. No source offer is required by either license.

Verbatim `wasm/LICENSE_JBIG2` (PDFium, BSD-3-Clause followed by the full
Apache-2.0 text):

```
// Copyright 2014 The PDFium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
                                 Apache License
                           Version 2.0, January 2004
                        https://www.apache.org/licenses/
   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
   1. Definitions.
      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.
      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.
      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.
      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.
      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.
      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.
      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).
      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.
      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."
      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.
   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.
   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.
   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:
      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and
      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and
      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and
      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.
      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.
   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.
   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.
   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.
   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.
   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.
   END OF TERMS AND CONDITIONS
   APPENDIX: How to apply the Apache License to your work.
      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.
   Copyright [yyyy] [name of copyright owner]
   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at
       https://www.apache.org/licenses/LICENSE-2.0
   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

Verbatim `wasm/LICENSE_PDFJS_JBIG2` (Mozilla's WebAssembly binding, Apache-2.0):

```
Copyright 2026 Mozilla Foundation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## openjpeg.wasm, openjpeg_nowasm_fallback.js

JPEG 2000 (JPX) image decoder. Upstream OpenJPEG (https://github.com/uclouvain/openjpeg),
BSD-2-Clause; Mozilla's WebAssembly binding is also BSD-2-Clause.

**Obligation.** BSD-2-Clause requires reproducing the copyright notice, the
conditions, and the disclaimer in binary redistributions, satisfied verbatim
below. No source offer is required. Note the upstream text's own caveat that
the software "may be subject to other third party and contributor rights,
including patent rights, and no such rights are granted under this license."

Verbatim `wasm/LICENSE_OPENJPEG`:

```
/*
 * The copyright in this software is being made available under the 2-clauses
 * BSD License, included below. This software may be subject to other third
 * party and contributor rights, including patent rights, and no such rights
 * are granted under this license.
 *
 * Copyright (c) 2002-2014, Universite catholique de Louvain (UCL), Belgium
 * Copyright (c) 2002-2014, Professor Benoit Macq
 * Copyright (c) 2003-2014, Antonin Descampe
 * Copyright (c) 2003-2009, Francois-Olivier Devaux
 * Copyright (c) 2005, Herve Drolon, FreeImage Team
 * Copyright (c) 2002-2003, Yannick Verschueren
 * Copyright (c) 2001-2003, David Janssens
 * Copyright (c) 2011-2012, Centre National d'Etudes Spatiales (CNES), France
 * Copyright (c) 2012, CS Systemes d'Information, France
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS `AS IS'
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
```

Verbatim `wasm/LICENSE_PDFJS_OPENJPEG` (Mozilla's WebAssembly binding):

```
Copyright (c) 2024, Mozilla Foundation

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## qcms_bg.wasm

Colour management, used to apply ICC profiles. Upstream qcms (Mozilla), MIT;
Mozilla's WebAssembly binding is also MIT.

**Obligation.** MIT requires the copyright notice and permission notice to be
included in all copies, satisfied verbatim below. No source offer is required.

Verbatim `wasm/LICENSE_QCMS`:

```
qcms
Copyright (C) 2009-2024 Mozilla Corporation
Copyright (C) 1998-2007 Marti Maria

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Verbatim `wasm/LICENSE_PDFJS_QCMS` (Mozilla's WebAssembly binding):

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## iccs/CGATS001Compat-v2-micro.icc

A CMYK ICC profile pdf.js uses through qcms. Released under CC0 1.0 Universal,
a public-domain dedication. The full text ships as `iccs/LICENSE` and is not
reproduced here because CC0 imposes no notice obligation; the file is named here
for provenance only.

**Obligation.** None.

---

## Summary

| Shipped asset                                  | Upstream                   | License                     | Notice required        | Source offer required |
| ---------------------------------------------- | -------------------------- | --------------------------- | ---------------------- | --------------------- |
| `jbig2.wasm`, `jbig2_nowasm_fallback.js`       | PDFium + Mozilla binding   | BSD-3-Clause and Apache-2.0 | Yes — reproduced above | No                    |
| `openjpeg.wasm`, `openjpeg_nowasm_fallback.js` | OpenJPEG + Mozilla binding | BSD-2-Clause                | Yes — reproduced above | No                    |
| `qcms_bg.wasm`                                 | qcms + Mozilla binding     | MIT                         | Yes — reproduced above | No                    |
| `CGATS001Compat-v2-micro.icc`                  | pdf.js                     | CC0 1.0                     | No                     | No                    |

No shipped asset carries a copyleft or source-offer obligation. That is a
consequence of the allow-list above, not an accident: see "What is deliberately
NOT shipped".
