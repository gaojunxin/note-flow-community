//! Native note persistence. The repository deliberately owns the SQL boundary so
//! callers receive stable domain errors instead of SQLite implementation details.

mod repository;

pub use repository::{
    CreateNote, NoteDetail, NotePage, NoteRepository, NoteRepositoryError, NoteRepositoryErrorCode,
    NoteSearchPage, NoteSummary, SearchHit, UpdateNote,
};
