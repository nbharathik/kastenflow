//! Tests of the bibliography: the BibTeX reader and what it makes of a
//! reference, how a citation is written, and the numbering of a deck.

mod bibtex;
mod format;
mod latex;
mod names;
mod numbering;
mod refs;
mod web_link;

/// Six real-looking entries: a conference paper with many authors, one with an
/// acronym in its venue, an arXiv preprint, a book, a journal article and a report.
pub(super) const SAMPLE: &str = r#"
@inproceedings{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and Kaiser, {\L}ukasz and Polosukhin, Illia},
  booktitle={Advances in Neural Information Processing Systems},
  volume={30},
  year={2017}
}

@inproceedings{devlin2019bert,
  title={{BERT}: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author={Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  booktitle={Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies (NAACL-HLT)},
  pages={4171--4186},
  year={2019}
}

@article{brown2020language,
  title={Language Models are Few-Shot Learners},
  author={Brown, Tom B. and Mann, Benjamin and Ryder, Nick and others},
  journal={arXiv preprint arXiv:2005.14165},
  year={2020}
}

@book{goodfellow2016deep,
  title={Deep Learning},
  author={Goodfellow, Ian and Bengio, Yoshua and Courville, Aaron},
  publisher={MIT Press},
  year={2016}
}

@article{lecun2015deep,
  title={Deep learning},
  author={LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal={Nature},
  volume={521},
  number={7553},
  pages={436--444},
  year={2015}
}

@misc{anthropic2024,
  title={The Claude 3 Model Family},
  author={{Anthropic}},
  howpublished={Technical report},
  year={2024}
}
"#;
