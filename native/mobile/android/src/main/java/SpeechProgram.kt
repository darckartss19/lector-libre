package org.lectorlibre.mobile

import org.json.JSONArray
import org.json.JSONObject

data class ReadingChapter(val id: String, val text: String)
data class ReadingChunk(val chapter: String, val start: Int, val end: Int, val text: String)

class SpeechProgram(data: JSONObject) {
    val bookId = data.getString("bookId")
    val title = data.optString("title", "Lectura en voz alta").take(160)
    val chapters: List<ReadingChapter>
    var voice = data.getString("voice")
    var rate = data.optDouble("rate", 1.0).toFloat()
    var index = 0
    var offset = 0
    val volume = data.optDouble("volume", 1.0).coerceIn(0.0, 1.0).toFloat()

    init {
        require(bookId.matches(Regex("[a-f0-9]{64}")) && rate.isFinite() && rate in 0.5f..3f)
        val rows = data.getJSONArray("chapters")
        require(rows.length() > 0)
        chapters = (0 until rows.length()).map { i ->
            val chapter = rows.getJSONObject(i)
            ReadingChapter(chapter.getString("id"), chapter.getString("text"))
        }
        require(chapters.all { it.id.isNotBlank() } && chapters.map { it.id }.distinct().size == chapters.size)
        data.optJSONObject("position")?.let { seek(it.getString("chapter"), it.getInt("offset")) }
    }

    fun seek(chapter: String, target: Int) {
        val i = chapters.indexOfFirst { it.id == chapter }
        require(i >= 0 && target in 0..chapters[i].text.length)
        index = i
        offset = safeOffset(chapters[i].text, target)
    }

    fun next(): ReadingChunk? {
        while (index < chapters.size) {
            val chapter = chapters[index]
            while (offset < chapter.text.length && chapter.text[offset].isWhitespace()) offset++
            if (offset < chapter.text.length) {
                var end = safeOffset(chapter.text, (offset + 350).coerceAtMost(chapter.text.length))
                if (end < chapter.text.length) {
                    val part = chapter.text.substring(offset, end)
                    val sentence = Regex("[.!?…][\\\"»”’]?\\s+|\\n+").findAll(part).lastOrNull()
                    val space = part.indexOfLast { it.isWhitespace() }
                    if (sentence != null && sentence.range.last >= part.length / 2) end = offset + sentence.range.last + 1
                    else if (space > part.length / 2) end = offset + space + 1
                }
                return ReadingChunk(chapter.id, offset, end, chapter.text.substring(offset, end))
            }
            if (index == chapters.lastIndex) return null
            index++
            offset = 0
        }
        return null
    }

    fun skip(direction: Int) {
        require(direction == -1 || direction == 1)
        var i = index
        while (i in chapters.indices) {
            val text = chapters[i].text
            val starts = (listOf(0) + Regex("[.!?…]+[\\\"»”’')\\]]*\\s+|\\r?\\n+").findAll(text).map { it.range.last + 1 })
                .map { start -> var s = start; while (s < text.length && text[s].isWhitespace()) s++; s }
                .filter { it < text.length }.distinct()
            val at = if (i == index) offset else if (direction > 0) -1 else text.length
            val target = if (direction > 0) starts.firstOrNull { it > at } else starts.lastOrNull { it < at }
            if (target != null) { index = i; offset = target; return }
            i += direction
        }
        index = if (direction > 0) chapters.lastIndex else 0
        offset = if (direction > 0) chapters[index].text.length else 0
    }

    fun position(): JSONObject = JSONObject().put("chapter", chapters[index].id).put("offset", offset)

    companion object {
        fun safeOffset(text: String, value: Int): Int =
            if (value in 1 until text.length && text[value].isLowSurrogate() && text[value - 1].isHighSurrogate()) value - 1 else value
    }
}
