"""API response models."""

from __future__ import annotations

from pydantic import BaseModel


class JobBase(BaseModel):
    id: str
    youtube_id: str | None = None


class JobProgress(JobBase):
    status: str
    progress: int | None = None
    message: str | None = None


class JobError(JobBase):
    status: str
    error: str | None = None


class JobComplete(JobBase):
    status: str
    result: dict
    progress: int | None = None


class SearchItem(BaseModel):
    id: str
    title: str
    duration: int


class SearchResponse(BaseModel):
    items: list[SearchItem]


class SpotifyItem(BaseModel):
    id: str | None = None
    name: str | None = None
    artist: str | None = None
    duration: int


class SpotifySearchResponse(BaseModel):
    items: list[SpotifyItem]


class TopSongItem(BaseModel):
    id: str | None = None
    youtube_id: str | None = None
    title: str | None = None
    artist: str | None = None
    play_count: int | None = None


class TopSongsResponse(BaseModel):
    items: list[TopSongItem]


class PlayCountResponse(BaseModel):
    id: str
    play_count: int


class AnalysisStartResponse(BaseModel):
    id: str
    status: str
    progress: int | None = None
    message: str | None = None
    message: str | None = None
