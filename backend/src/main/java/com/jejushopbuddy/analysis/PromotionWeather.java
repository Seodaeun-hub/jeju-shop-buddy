package com.jejushopbuddy.analysis;

import com.jejushopbuddy.analysis.PromotionDraftController.ChannelCopy;
import com.jejushopbuddy.analysis.StorePromotionToneController.Tone;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Service;

@Service
class PromotionWeather {
    private final KmaForecast weather;

    PromotionWeather(KmaForecast weather) {
        this.weather = weather;
    }

    Context resolve(String address, String store, String area, LocalDate date, String avoid) {
        var forecast = weather.lookup(address, store, date);
        return context(area, date, forecast == null ? null : forecast.label(),
                forecast == null ? null : forecast.issuedAt(), avoid);
    }

    static boolean shouldRefresh(Context saved, LocalDate date) {
        if (saved == null) return false;
        if (saved.forecast() != null && !KmaForecast.SOURCE_URL.equals(saved.sourceUrl())) return true;
        return KmaForecast.withinForecastWindow(date) && !KmaForecast.currentIssue(saved.issuedAt());
    }

    static Context context(String area, LocalDate date, String forecast, OffsetDateTime issuedAt, String avoid) {
        String season = switch (date.getMonthValue()) {
            case 3, 4, 5 -> "봄";
            case 6, 7, 8 -> "여름";
            case 9, 10, 11 -> "가을";
            default -> "겨울";
        };
        String day = "제주의 " + season + "날";
        String intro = switch (forecast == null ? "" : forecast) {
            case "맑음 예보" -> "맑을 것으로 예보된 " + day;
            case "구름 예보" -> "구름이 낄 것으로 예보된 " + day;
            case "" -> day;
            default -> forecast + "가 있는 " + day;
        };
        var leads = new ChannelCopy(
                allowed(intro + ", 저희 가게 소식을 전해요.", avoid),
                allowed(intro + "에 맞춰 매장 소식을 안내드립니다.", avoid),
                allowed(intro + "이네요. 동네에서 들르실 때 참고해 주세요.", avoid));
        return new Context(date, area, season, forecast, forecast == null ? null : KmaForecast.SOURCE_URL, leads, issuedAt);
    }

    private static String allowed(String line, String avoid) {
        return Tone.containsAvoidedPhrase(line, avoid) ? "" : line;
    }

    record Context(LocalDate date, String area, String season, String forecast, String sourceUrl, ChannelCopy leads,
                   OffsetDateTime issuedAt) {
        Context withLeads(ChannelCopy applied) {
            return new Context(date, area, season, forecast, sourceUrl, applied, issuedAt);
        }
    }
}
