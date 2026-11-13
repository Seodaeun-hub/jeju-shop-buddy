package com.jejushopbuddy.analysis;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.jejushopbuddy.analysis.MenuCostController.Ingredient;
import java.util.List;
import org.junit.jupiter.api.Test;

class MenuCostTest {
    @Test
    void calculatesPerPortionChangeAndTotal() {
        var before = MenuCostController.calculate("고기국수", List.of(new Ingredient("돼지고기", "kg", "0.5", 8000L)));
        var after = MenuCostController.calculate("고기국수", List.of(new Ingredient("돼지고기", "kg", "0.5", 9000L)));
        var total = MenuCostController.calculate("고기국수", List.of(
                after.ingredients().getFirst(), new Ingredient("면", "kg", "0.2", 4000L),
                new Ingredient("육수", "L", "0.4", 1000L)));

        assertThat(before.costWon()).isEqualTo(4000);
        assertThat(after.costWon() - before.costWon()).isEqualTo(500);
        assertThat(total.costWon()).isEqualTo(5700);
    }

    @Test
    void roundsOnceAndRejectsDuplicateIngredients() {
        var first = new Ingredient("면", "kg", "0.002", 200L);
        var second = new Ingredient("육수", "L", "0.002", 200L);
        assertThat(MenuCostController.calculate("고기국수", List.of(first, second)).costWon()).isEqualTo(1);
        assertThatThrownBy(() -> MenuCostController.calculate("고기국수", List.of(first, first)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
