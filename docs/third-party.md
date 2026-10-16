# Third-party software

KastenFlow's own licence is in `LICENSE`. The libraries, icons and typeface that ship inside the app are
listed, each with its licence text, in the app (Settings, About) and in `app/public/third-party-notices.txt`,
which is written again for every release build. This page is about software KastenFlow can download after you
ask for it, and it names the libraries that version 1.2.1 added to the app.

## Libraries added in 1.2.1: checking the ChatGPT sign-in

KastenFlow 1.2.1 checks the signature of the identity token that comes back from "Continue with ChatGPT"
against OpenAI's published keys, and ties the sign-in to one account. It does this with `jsonwebtoken` 10
(MIT), which brings in the pure-Rust RustCrypto implementations of the signature algorithms a token may name.
They are compiled into the app. They add 38 packages in all, listed here by the licence each declares; the
generated notices file is the record. The full licence and copyright text of each is in Settings, About and in `app/public/third-party-notices.txt`
once that file is written for the release; where this page gives only a name and an SPDX identifier, the text is
not repeated here.

| Licence (SPDX) | Crates |
| --- | --- |
| MIT | `jsonwebtoken` 10.4.0, `libm` 0.2.16, `spin` 0.9.9 |
| BSD-3-Clause | `curve25519-dalek` 4.1.3, `ed25519-dalek` 2.2.0, `subtle` 2.6.1 |
| MIT OR Apache-2.0 OR BSD-1-Clause | `fiat-crypto` 0.2.9 |
| MIT OR Apache-2.0 | `rsa` 0.9.10, `p256` 0.13.2, `p384` 0.13.1, `primeorder` 0.13.6, `ecdsa` 0.16.9, `ed25519` 2.2.3, `elliptic-curve` 0.13.8, `crypto-bigint` 0.5.5, `ff` 0.13.1, `group` 0.13.0, `rfc6979` 0.4.0, `sec1` 0.7.3, `signature` 2.2.0, `der` 0.7.10, `pkcs1` 0.7.5, `pkcs8` 0.10.2, `spki` 0.7.3, `pem-rfc7468` 0.7.0, `base16ct` 0.2.0, `base64ct` 1.8.3, `const-oid` 0.9.6, `hmac` 0.12.1, `hkdf` 0.12.4, `num-bigint-dig` 0.8.6, `rand` 0.8.8, `rand_chacha` 0.3.1, `rand_core` 0.6.4, `getrandom` 0.2.17, `lazy_static` 1.5.1, `zeroize_derive` 1.5.0, `curve25519-dalek-derive` 0.1.1 |

Every licence above allows use and redistribution with the licence text and copyright notice kept; none is
copyleft. The `rsa` crate has a published advisory (RUSTSEC-2023-0071, a timing side channel in RSA operations
with a private key). KastenFlow only checks signatures with OpenAI's public keys and never holds a private RSA
key, so the advisory does not apply to how it is used.

`slides-bib`, a small BibTeX reader added in the same release, is KastenFlow's own code under Apache-2.0 and has
no dependencies.

## Diagram editor: draw.io (diagrams.net)

Credit, as it appears in the app: **Diagram editor: draw.io (diagrams.net), Apache-2.0**.

KastenFlow draws and edits diagrams with draw.io, an open source editor by JGraph Ltd. It is not part of the
KastenFlow download. It is installed once, when you press **Install diagram editor** in Diagrams (or in
Settings, Diagrams), and KastenFlow works without it: diagrams already in your vault show as pictures in pages
and whiteboards, and their SVG pictures can be exported, with no editor. Drawing and
changing a diagram, and making a PNG of one, need it.

- **What is downloaded.** One file, `draw.war`, version 32.2.0, from
  `https://github.com/jgraph/drawio/releases/download/v32.2.0/draw.war` (48,235,802 bytes, SHA-256
  `32b9aa48b9b4dfb8b70b8c3a47bc2ee4265ae462bbce1b53492d30ef79916c5d`). KastenFlow checks the size and the
  checksum before it unpacks anything, and installs nothing that does not match. It never looks for a newer
  version by itself.
- **Where it goes.** A folder of its own in KastenFlow's data folder on your computer, never your vault. The
  licence and notice files that come with the download (the release has no licence file at its
  top; the folders of pictures, shapes, stencils, templates and routing code each have one) are kept
  beside it, in a `legal` folder. **Remove** in Settings deletes
  that folder and nothing else.
- **How it runs.** In a sandboxed frame, served to the app from that folder by KastenFlow itself. The policy
  KastenFlow gives the editor's page lets it make no connection outside the page and load nothing from the web, and
  the frame cannot reach KastenFlow's commands, your vault or the rest of the window.
- **Your diagrams.** A diagram is a plain file in your vault, `name.drawio` (the editor's own XML format),
  with a picture beside it, `name.drawio.svg`. Both are yours; any draw.io app opens the first.

### Licence

draw.io is licensed under the Apache License, Version 2.0, reproduced here as it asks to be passed on.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

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
```

The copyright notice that comes with draw.io names JGraph Ltd. Whatever licence and notice files the
download itself carries are kept with the installed editor, in its `legal` folder; where they differ
from the text above for a folder of pictures, shapes or templates, those apply to that folder.
