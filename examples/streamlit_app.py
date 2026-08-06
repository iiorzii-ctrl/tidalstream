"""東京湾の風予報を、地図と時刻スライダで見る Streamlit 版。

tidalstream のサーバが出す JSON（/api/wind）を読むだけで、上流サイトの
HTML も資格情報もこちら側には要らない。資格情報は Node 側の環境変数に
置いたままにする（このファイルには書かない）。

    pip install streamlit pandas pydeck
    streamlit run examples/streamlit_app.py

    # 別の場所で動かしている場合
    WIND_URL=https://<ホスト>/api/wind streamlit run examples/streamlit_app.py

サーバがまだ上流を取り込めない間は、作り物のデータで見た目を作れる。

    UMITEN_SAMPLE=1 node server.mjs
    WIND_URL='http://127.0.0.1:3000/api/wind?sample=1' streamlit run examples/streamlit_app.py
"""

from __future__ import annotations

import os

import pandas as pd
import pydeck as pdk
import requests
import streamlit as st

WIND_URL = os.environ.get("WIND_URL", "http://127.0.0.1:3000/api/wind")
MS_TO_KNOTS = 1.94384

# 取得元が Basic 認証の内側にある場合だけ使う（tidalstream 自身の認証であって、
# 予報サイトのものではない）。
TIDALSTREAM_USER = os.environ.get("TIDALSTREAM_USER")
TIDALSTREAM_PASS = os.environ.get("TIDALSTREAM_PASS")

st.set_page_config(page_title="東京湾 風予報", layout="wide")


@st.cache_data(ttl=600)
def load_forecast(url: str) -> dict:
    auth = (TIDALSTREAM_USER, TIDALSTREAM_PASS) if TIDALSTREAM_USER and TIDALSTREAM_PASS else None
    response = requests.get(url, timeout=30, auth=auth)
    response.raise_for_status()
    return response.json()


def to_frame(forecast: dict) -> pd.DataFrame:
    """1行 = 1地点 × 1時刻 に開く（サーバの /api/wind.csv と同じ形）。"""
    rows = [
        {
            "time": point["time"],
            "station_id": station["id"],
            "station_name": station["name"],
            "lat": station["lat"],
            "lon": station["lon"],
            "page_url": station.get("pageUrl"),
            "speed_mps": point["speed"],
            "gust_mps": point["gust"],
            "direction_deg": point["direction"],
            "direction_text": point["directionText"],
        }
        for station in forecast["stations"]
        for point in station["series"]
    ]
    frame = pd.DataFrame(rows)
    frame["time"] = pd.to_datetime(frame["time"])
    frame["speed_kt"] = frame["speed_mps"] * MS_TO_KNOTS
    return frame


try:
    forecast = load_forecast(WIND_URL)
except Exception as error:  # 接続できない・認証で弾かれた等
    st.error(f"予報を取得できませんでした: {error}")
    st.caption(f"取得先: {WIND_URL}")
    st.stop()

if forecast.get("source", {}).get("kind") == "sample":
    st.warning("表示しているのは作り物のサンプルデータで、実際の予報ではありません。")

frame = to_frame(forecast)

st.title("東京湾 風予報")
issued = forecast.get("issuedAt")
st.caption(f"発表: {issued or '不明'} ／ 出典: {forecast['source']['name']}")

# --- 時刻のスライダ（地図の下ではなく横に置くのが Streamlit では素直） ---
times = sorted(frame["time"].unique())
unit = st.radio("単位", ["m/s", "kt"], horizontal=True, index=0)
picked = st.select_slider(
    "時刻",
    options=times,
    value=times[0],
    format_func=lambda t: pd.Timestamp(t).strftime("%m/%d %H:%M"),
)

at_time = frame[frame["time"] == picked].dropna(subset=["lat", "lon"]).copy()
at_time["speed"] = at_time["speed_kt"] if unit == "kt" else at_time["speed_mps"]
at_time["label"] = at_time["speed"].map(lambda v: "—" if pd.isna(v) else f"{v:.1f}")

# 風向は「吹いてくる方角」なので、矢印は 180 度回して「吹いていく向き」で描く
at_time["arrow_deg"] = (at_time["direction_deg"] + 180) % 360


def colour(speed_mps: float) -> list[int]:
    if pd.isna(speed_mps):
        return [150, 150, 150]
    if speed_mps < 5:
        return [60, 140, 220]
    if speed_mps < 10:
        return [230, 170, 40]
    return [220, 70, 60]


at_time["color"] = at_time["speed_mps"].map(colour)

st.pydeck_chart(
    pdk.Deck(
        map_style=None,
        initial_view_state=pdk.ViewState(latitude=35.3, longitude=139.85, zoom=8.4),
        layers=[
            pdk.Layer(
                "ScatterplotLayer",
                at_time,
                get_position=["lon", "lat"],
                get_fill_color="color",
                get_radius=1400,
                pickable=True,
            ),
            pdk.Layer(
                "TextLayer",
                at_time,
                get_position=["lon", "lat"],
                get_text="label",
                get_size=15,
                get_color=[20, 20, 20],
                get_pixel_offset=[0, -22],
            ),
        ],
        tooltip={"text": "{station_name}\n{label} " + unit + "\n{direction_text}"},
    )
)

st.subheader("地点ごとの値")
st.dataframe(
    at_time[["station_name", "label", "direction_text", "gust_mps", "page_url"]].rename(
        columns={
            "station_name": "地点",
            "label": f"風速 ({unit})",
            "direction_text": "風向",
            "gust_mps": "突風 (m/s)",
            "page_url": "予報ページ",
        }
    ),
    hide_index=True,
    use_container_width=True,
    column_config={"予報ページ": st.column_config.LinkColumn("予報ページ", display_text="開く")},
)
